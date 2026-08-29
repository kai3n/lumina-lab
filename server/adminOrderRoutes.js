// 어드민 실주문 콘솔 API — Postgres 주문(BD-)의 목록/상세.
// 상태 전이·발행은 customerRoutes의 POST /v1/admin/orders/:code/events가 담당.
import { Router } from "express";
import { rateLimit } from "./rateLimit.js";
import { requireAdmin, requireFullAdmin } from "./middleware.js";
import { query } from "./db.js";
import { listAdminOrders, getAdminOrder, listAdminStyles, upsertAdminStyle, deleteAdminStyle } from "./adminRepository.js";
import { getSettingsValues, putSettingsValues, PUBLIC_SETTINGS_KEYS } from "./settingsRepository.js";
import { getAdminSupplierOrderContext } from "./supplierRepository.js";

const MINUTE = 60 * 1000;

export function adminOrderRouter() {
  const r = Router();

  r.get("/orders",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireAdmin,
    async (_req, res, next) => {
      try {
        res.json({ ok: true, orders: await listAdminOrders() });
      } catch (e) { next(e); }
    });

  // 회원 CRM — 프로필(언어·기본 배송지) + 주문 요약(건수·총구매액·주문 목록, 최신 견적 총액 기준)
  r.get("/customers",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireAdmin,
    async (_req, res, next) => {
      try {
        const { rows } = await query(
          `
            select
              c.id, c.customer_code, c.email, c.name, c.phone, c.locale, c.default_address, c.created_at,
              count(o.id) as order_count,
              coalesce(sum(case when o.stage = 'DELIVERED' then q.total_usd end), 0) as total_spent,
              coalesce(sum(case when o.stage not in ('DELIVERED', 'CANCELLED') then q.total_usd end), 0) as open_value,
              coalesce(
                json_agg(
                  json_build_object(
                    'orderCode', o.order_code, 'stage', o.stage, 'updatedAt', o.updated_at, 'totalUsd', q.total_usd
                  ) order by o.updated_at desc
                ) filter (where o.id is not null),
                '[]'::json
              ) as orders
            from customers c
            left join customer_orders o on o.customer_id = c.id
            left join lateral (
              select case
                when pa.payload->>'totalUsd' ~ '^[0-9]+([.][0-9]+)?$' then (pa.payload->>'totalUsd')::numeric
                else null
              end as total_usd
              from published_artifacts pa
              where pa.order_id = o.id and pa.type = 'QUOTE' and pa.payload ? 'totalUsd'
              order by pa.published_at desc, pa.id desc
              limit 1
            ) q on true
            group by c.id
            order by c.created_at desc
          `,
        );
        res.json({
          ok: true,
          customers: rows.map((r2) => ({
            id: r2.id,
            customerCode: r2.customer_code,
            email: r2.email,
            name: r2.name,
            phone: r2.phone,
            locale: r2.locale,
            defaultAddress: r2.default_address || null,
            joinedAt: r2.created_at,
            orderCount: Number(r2.order_count),
            totalSpent: Number(r2.total_spent),
            openValue: Number(r2.open_value),
            orders: r2.orders || [],
          })),
        });
      } catch (e) { next(e); }
    });

  r.get("/orders/:orderCode",
    rateLimit({ limit: 120, windowMs: MINUTE }),
    requireAdmin,
    async (req, res, next) => {
      try {
        const order = await getAdminOrder(req.params.orderCode);
        // 어드민은 전체 이력 — 타임라인(내부 포함)·발행물·고객 액션까지 한 번에
        const { rows: [{ id: orderId }] } = await query(
          "select id from customer_orders where order_code = $1", [req.params.orderCode],
        );
        const [timeline, artifacts, actions, supplierJob] = await Promise.all([
          query("select * from customer_timeline_events where order_id = $1 order by created_at desc", [orderId]),
          query("select * from published_artifacts where order_id = $1 order by published_at desc", [orderId]),
          query("select * from customer_actions where order_id = $1 order by created_at desc", [orderId]),
          getAdminSupplierOrderContext(req.params.orderCode),
        ]);
        res.json({
          ok: true,
          order,
          timeline: timeline.rows.map((row) => ({
            id: row.event_code, title: row.title, body: row.body, payload: row.payload || {}, createdAt: row.created_at,
          })),
          artifacts: artifacts.rows.map((row) => ({
            id: row.artifact_code, type: row.type, versionLabel: row.version_label,
            media: row.media || [], payload: row.payload || {}, publishedAt: row.published_at,
          })),
          actions: actions.rows.map((row) => ({
            id: row.action_code, kind: row.kind, status: row.status, title: row.title,
            allowedResponses: row.allowed_responses || [], responsePayload: row.response_payload || null,
            respondedAt: row.responded_at, createdAt: row.created_at,
          })),
          supplierJob,
        });
      } catch (e) { next(e); }
    });

  // ── 카탈로그(스타일) CRUD — 어드민 편집이 고객 카탈로그의 진실이 된다 ──
  r.get("/designs",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireAdmin,
    async (_req, res, next) => {
      try {
        res.json({ ok: true, styles: await listAdminStyles() });
      } catch (e) { next(e); }
    });

  r.put("/designs/:styleCode",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireAdmin,
    async (req, res, next) => {
      try {
        res.json({ ok: true, style: await upsertAdminStyle(req.params.styleCode, req.body || {}) });
      } catch (e) { next(e); }
    });

  r.delete("/designs/:styleCode",
    rateLimit({ limit: 30, windowMs: MINUTE }),
    requireAdmin,
    async (req, res, next) => {
      try {
        res.json({ ok: true, ...(await deleteAdminStyle(req.params.styleCode)) });
      } catch (e) { next(e); }
    });

  // ── 운영 설정 — 가격표(diamond/metal)·결제 채널·카탈로그 카피·스펙 ──
  r.get("/settings",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireAdmin,
    async (_req, res, next) => {
      try {
        res.json({ ok: true, settings: await getSettingsValues(PUBLIC_SETTINGS_KEYS) });
      } catch (e) { next(e); }
    });

  r.put("/settings",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireFullAdmin, // 쿠폰·가격표·결제채널·배너가 사는 곳 — bot_admin 금지
    async (req, res, next) => {
      try {
        res.json({ ok: true, settings: await putSettingsValues(req.body || {}) });
      } catch (e) { next(e); }
    });

  return r;
}
