import { Router } from "express";
import { ApiError } from "./errors.js";
import { rateLimit } from "./rateLimit.js";
import { withTransaction, query } from "./db.js";
import {
  createDraftIntake, submitIntake, requestHash, recordOrderEvent, EVENT_TRANSITIONS,
  listCustomerOrders, getCustomerOrder, respondToAction, listServerOrders,
  updateOrderShippingAddress, reportOrderPayment, cancelOrder, listPublishedStyles,
} from "./customerRepository.js";
import { getSettingsValues, PUBLIC_SETTINGS_KEYS } from "./settingsRepository.js";
import { sendOrderEventMail } from "./orderMail.js";
import { requireAdmin, requireCustomer } from "./middleware.js";

const MINUTE = 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 돈이 걸린 주문 이벤트 — 가격 커밋(제안)·결제 확인·잔금 요청·취소(환불 판단)는 사람 어드민만
const FULL_ADMIN_EVENTS = new Set([
  "proposal_sent", "deposit_confirmed", "balance_requested", "balance_confirmed", "order_cancelled",
]);

// 메일은 응답 이후 fire-and-forget — 발송 실패가 제출/이벤트를 실패시키지 않는다 (스펙 §5)
function fireMail(promise, label) {
  promise.catch((e) => console.error(`[orderMail] ${label}: ${e.message}`));
}

export function customerRouter() {
  const r = Router();

  // 인테이크 제출 — draft 생성+제출 원샷. 더블클릭/재시도는 Idempotency-Key로 흡수.
  // 왜: 공유 IP 버킷과 분리 — 브라우징 트래픽(activity/auth)이 인테이크 한도를 소모해 오탐 429가 나는 것을 막는다.
  r.post("/intakes",
    rateLimit({ limit: 5, windowMs: MINUTE, keyFn: (req) => `intakes:${req.ip}` }),
    async (req, res, next) => {
      try {
        const payload = req.body || {};
        const email = String(payload.contactEmail || payload.email || "").trim().toLowerCase();
        if (!EMAIL_RE.test(email)) throw new ApiError("VALIDATION_ERROR", 400, "contact email required");
        const idemKey = req.get("Idempotency-Key") || null;
        if (idemKey) {
          // 같은 키의 동시 요청 직렬화 — check-then-act 레이스로 주문·메일이 중복 생성되는 것을 막는다
          const outcome = await withTransaction(async (client) => {
            await client.query("select pg_advisory_xact_lock(hashtext($1))", [`/v1/intakes:${idemKey}`]);
            const { rows } = await client.query(
              "select request_hash, status_code, response_json from idempotency_keys where route = $1 and idempotency_key = $2",
              ["/v1/intakes", idemKey],
            );
            if (rows[0]) {
              if (rows[0].request_hash !== requestHash(payload)) throw new ApiError("IDEMPOTENCY_KEY_REUSED", 409);
              return { replay: true, status: rows[0].status_code, body: rows[0].response_json };
            }
            const draft = await createDraftIntake(payload);
            const result = await submitIntake(draft.intakeId);
            const body = { ok: true, orderCode: result.orderCode, stage: result.stage };
            await client.query(
              `insert into idempotency_keys (route, idempotency_key, request_hash, status_code, response_json)
               values ($1, $2, $3, 201, $4)`,
              ["/v1/intakes", idemKey, requestHash(payload), body],
            );
            return { replay: false, status: 201, body, result };
          });
          res.status(outcome.status).json(outcome.body);
          if (!outcome.replay && outcome.result.created && outcome.result.notify?.email) {
            fireMail(sendOrderEventMail({ ...outcome.result.notify, orderCode: outcome.result.orderCode, type: "received" }), "received");
          }
          return;
        }
        const draft = await createDraftIntake(payload);
        const result = await submitIntake(draft.intakeId);
        const body = { ok: true, orderCode: result.orderCode, stage: result.stage };
        res.status(201).json(body);
        if (result.created && result.notify?.email) {
          fireMail(sendOrderEventMail({ ...result.notify, orderCode: result.orderCode, type: "received" }), "received");
        }
      } catch (e) { next(e); }
    });

  // 주문 상태 이벤트 — 어드민 전용. 서버 상태 머신이 단계·필수조건·중복을 검증한다.
  r.post("/admin/orders/:orderCode/events",
    rateLimit({ limit: 30, windowMs: MINUTE, keyFn: (req) => `order-events:${req.ip}` }),
    requireAdmin,
    async (req, res, next) => {
      try {
        const { type, data, artifact, action } = req.body || {};
        // 왜: EVENT_TRANSITIONS[type]는 상속된 Object.prototype 속성명("toString" 등)도 truthy로 통과시킨다 — own-property로만 검사
        if (!Object.hasOwn(EVENT_TRANSITIONS, type) || type === "received") {
          throw new ApiError("VALIDATION_ERROR", 422, "unknown event type");
        }
        if (FULL_ADMIN_EVENTS.has(type) && req.principal?.type !== "admin") {
          throw new ApiError("FULL_ADMIN_REQUIRED", 403);
        }
        // artifact(포털 공개 미디어/페이로드)·action(열릴 고객 컨펌)은 stage 전이와 같은 트랜잭션에서 발행
        const result = await recordOrderEvent(req.params.orderCode, type, data || {}, { artifact, action });
        res.status(201).json({ ok: true, orderCode: result.orderCode, stage: result.stage, eventId: result.eventId, artifactCode: result.artifactCode || null, actionCode: result.actionCode || null });
        if (result.notify?.email) {
          // 결제 확인 이벤트면 리포지토리가 확정한 영수증(금액·잔액)을 메일 본문에 싣는다
          const mailData = { ...(data || {}), ...(result.receipt ? { receipt: result.receipt } : {}) };
          fireMail(sendOrderEventMail({ ...result.notify, orderCode: result.orderCode, type, data: mailData }), type);
        }
      } catch (e) { next(e); }
    });

  // 어드민 실주문 콘솔 — 서버 주문 목록 (어드민이 실제 BD- 주문에 상태 이벤트를 발사할 대상)
  r.get("/admin/orders",
    rateLimit({ limit: 60, windowMs: MINUTE, keyFn: (req) => `admin-orders:${req.ip}` }),
    requireAdmin,
    async (req, res, next) => {
      try {
        res.json({ orders: await listServerOrders({ limit: Number(req.query.limit) || 100 }) });
      } catch (e) { next(e); }
    });

  // ── 고객 포털 읽기 — 세션 쿠키 기준. 레포지토리는 이메일 키라 principal id → email 변환.
  async function principalEmail(req) {
    const { rows } = await query("select email from customers where id = $1", [req.principal.id]);
    if (!rows[0]) throw new ApiError("CUSTOMER_AUTH_REQUIRED", 401);
    return rows[0].email;
  }

  r.get("/orders",
    rateLimit({ limit: 30, windowMs: MINUTE }),
    requireCustomer,
    async (req, res, next) => {
      try {
        const orders = await listCustomerOrders(await principalEmail(req));
        res.json({ ok: true, orders });
      } catch (e) { next(e); }
    });

  r.get("/orders/:orderCode",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireCustomer,
    async (req, res, next) => {
      try {
        const order = await getCustomerOrder(req.params.orderCode, await principalEmail(req));
        res.json({ ok: true, order });
      } catch (e) { next(e); }
    });

  // 디파짓 단계 배송지 — summary.shippingAddress에 저장, 어드민 상세에 그대로 노출
  r.post("/orders/:orderCode/shipping-address",
    rateLimit({ limit: 20, windowMs: MINUTE }),
    requireCustomer,
    async (req, res, next) => {
      try {
        const result = await updateOrderShippingAddress(req.params.orderCode, await principalEmail(req), req.body || {});
        res.json(result);
      } catch (e) { next(e); }
    });

  // 송금 셀프 리포트 (deposit|balance) — 타임라인 기록 + waiting_on을 BeloveD로
  r.post("/orders/:orderCode/payment-reported",
    rateLimit({ limit: 10, windowMs: MINUTE }),
    requireCustomer,
    async (req, res, next) => {
      try {
        const result = await reportOrderPayment(req.params.orderCode, await principalEmail(req), req.body?.kind);
        res.json(result);
      } catch (e) { next(e); }
    });

  // 주문 취소 — 디파짓 전 즉시 취소 / 제작 중 취소 요청 / 완성 후 400
  r.post("/orders/:orderCode/cancel",
    rateLimit({ limit: 10, windowMs: MINUTE }),
    requireCustomer,
    async (req, res, next) => {
      try {
        const result = await cancelOrder(req.params.orderCode, await principalEmail(req), req.body?.reason);
        res.json({ ok: true, cancelled: Boolean(result.cancelled), requested: Boolean(result.requested) });
        if (result.customerEmail) {
          const type = result.cancelled ? "order_cancelled" : "cancel_requested";
          fireMail(sendOrderEventMail({
            email: result.customerEmail, locale: result.locale, orderCode: req.params.orderCode, type, data: {},
          }), type);
        }
      } catch (e) { next(e); }
    });

  // 열린 고객 액션 응답 (컨펌/반려) — allowed_responses 화이트리스트는 레포지토리가 검증
  r.post("/actions/:actionCode/respond",
    rateLimit({ limit: 20, windowMs: MINUTE }),
    requireCustomer,
    async (req, res, next) => {
      try {
        const result = await respondToAction(req.params.actionCode, await principalEmail(req), req.body || {});
        res.json({ ok: true, ...result });
      } catch (e) { next(e); }
    });

  // ── 공개 카탈로그 — 어드민이 편집한 스타일이 모든 고객 브라우저에 도달하는 경로 ──
  r.get("/designs",
    rateLimit({ limit: 120, windowMs: MINUTE, keyFn: (req) => `designs:${req.ip}` }),
    async (_req, res, next) => {
      try {
        res.json({ ok: true, styles: await listPublishedStyles() });
      } catch (e) { next(e); }
    });

  // 공개 설정 — 견적 추정(가격표·정책값)·결제 채널(Zelle/Venmo)이 소비
  r.get("/settings/public",
    rateLimit({ limit: 120, windowMs: MINUTE, keyFn: (req) => `settings:${req.ip}` }),
    async (_req, res, next) => {
      try {
        res.json({ ok: true, settings: await getSettingsValues(PUBLIC_SETTINGS_KEYS) });
      } catch (e) { next(e); }
    });

  return r;
}
