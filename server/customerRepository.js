import { createHash } from "node:crypto";
import { query, withTransaction } from "./db.js";
import { ApiError } from "./errors.js";
import { createReadUrl } from "./media.js";
import { syncCustomerOrderToSupplierWorkflow } from "./supplierWorkflowContract.js";

export { ApiError }; // adminRepository 등 기존 import 경로 호환

const sequenceByPrefix = {
  CUS: "customer_code_seq",
  IN: "intake_code_seq",
  BD: "order_code_seq",
  ACT: "action_code_seq",
  ART: "artifact_code_seq",
  TL: "timeline_code_seq",
  MED: "media_code_seq",
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function publicCode(prefix, value) {
  return `${prefix}-${String(value).padStart(6, "0")}`;
}

async function nextCode(client, prefix) {
  const sequence = sequenceByPrefix[prefix];
  if (!sequence) throw new ApiError("BAD_CODE_PREFIX", 500);
  const { rows } = await client.query(`select nextval('${sequence}') as value`);
  return publicCode(prefix, rows[0].value);
}

function moneyToMinorUnits(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const DEPOSIT_RATE_MIN = 0.1;
const DEPOSIT_RATE_MAX = 0.9;
const DEFAULT_DEPOSIT_RATE = 0.5;

function validationError(message) {
  return new ApiError("VALIDATION_ERROR", 422, message);
}

function stateConflict(message, code = "INVALID_ORDER_TRANSITION") {
  return new ApiError(code, 409, message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanRequiredText(value, field, maxLength = 200) {
  if (typeof value !== "string" || !value.trim()) throw validationError(`${field} is required`);
  const clean = value.trim();
  if (clean.length > maxLength) throw validationError(`${field} is too long`);
  return clean;
}

function positiveMoney(value, field) {
  const amount = Number(value);
  const minorUnits = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    throw validationError(`${field} must be a positive amount`);
  }
  // Quotes and receipts are USD amounts. Persisting fractions of a cent makes
  // later balance comparisons depend on floating-point tolerances and can let a
  // zero-rounded deposit advance the order without a receipt.
  if (Math.abs(amount * 100 - minorUnits) > 1e-7) {
    throw validationError(`${field} must use whole cents`);
  }
  return minorUnits / 100;
}

function computedDeposit(total, rate) {
  const totalMinor = moneyToMinorUnits(total);
  if (!Number.isInteger(totalMinor) || totalMinor <= 1) {
    throw validationError("artifact.payload.totalUsd must leave a positive deposit and balance");
  }
  const depositMinor = Math.max(1, Math.round(totalMinor * normalizedDepositRate(rate)));
  if (depositMinor >= totalMinor) {
    throw validationError("artifact.payload.depositUsd must be less than totalUsd");
  }
  return depositMinor / 100;
}

function normalizedDepositRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= DEPOSIT_RATE_MIN && rate <= DEPOSIT_RATE_MAX
    ? rate
    : DEFAULT_DEPOSIT_RATE;
}

async function configuredDepositRate(client) {
  const { rows } = await client.query("select value from app_settings where key = 'opsDepositRate'");
  return normalizedDepositRate(rows[0]?.value);
}

function styleView(row) {
  // payload = 클라이언트 스토어 스타일 원본 — 공개 카탈로그는 이 형태를 그대로 소비한다
  if (row.payload && Object.keys(row.payload).length > 0) {
    return { ...row.payload, id: row.style_code, category: row.category, published: row.published };
  }
  return {
    styleCode: row.style_code,
    category: row.category,
    name: row.name,
    summary: row.summary,
    heroMedia: row.hero_media,
    media: row.media,
    supportedMetals: row.supported_metals,
    stoneRange: row.stone_range,
    leadTimeDays: {
      min: row.lead_time_min_days,
      max: row.lead_time_max_days,
    },
  };
}

function actionView(row) {
  if (!row) return null;
  return {
    id: row.action_code,
    kind: row.kind,
    status: row.status,
    title: row.title,
    description: row.description,
    subjectType: row.subject_type,
    subjectVersionId: row.subject_version_id,
    dueAt: row.due_at,
    allowedResponses: row.allowed_responses || [],
  };
}

function artifactView(row) {
  return {
    id: row.artifact_code,
    type: row.type,
    versionLabel: row.version_label,
    publishedAt: row.published_at,
    media: row.media || [],
    payload: row.payload || {},
  };
}

async function readableArtifactView(row) {
  const artifact = artifactView(row);
  artifact.media = await Promise.all(artifact.media.map(async (item) => {
    if (!item?.key) return item;
    return {
      ...item,
      src: await createReadUrl({ key: item.key, provider: item.provider || "cos" }),
    };
  }));
  return artifact;
}

function timelineView(row) {
  return {
    id: row.event_code,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    payload: row.payload || {},
  };
}

// 3단계 여정 — 디자인 승인 스텝은 제품 flow에서 제거됨(초안 수락=디자인 승인)이라 별도 단계로 두지 않는다
function phaseViews(stage) {
  const keys = [
    ["DEFINE", "Confirm your piece"],
    ["MAKING", "We are making it"],
    ["DELIVERY", "Complete and deliver"],
  ];
  const activeIndex = stage === "CANCELLED"
    ? -1
    : stage === "DELIVERED"
      ? 2
      // DEPOSIT(디파짓 대기)은 아직 '피스 확정' 단계 — 제작은 입금 확인부터
      : ["CAD", "PRODUCTION", "FINAL_QC"].includes(stage)
        ? 1
        : stage === "BALANCE" || stage === "SHIPPING"
          ? 2
          : 0;

  return keys.map(([key, title], index) => ({
    key,
    title,
    state: stage === "CANCELLED"
      ? "blocked"
      : stage === "DELIVERED" || index < activeIndex
        ? "complete"
        : index === activeIndex ? "active" : "upcoming",
  }));
}

function orderSummaryView(row, nextAction = null) {
  return {
    orderCode: row.order_code,
    stage: row.stage,
    phase: row.phase,
    waitingOn: row.waiting_on,
    expectedCompletionAt: row.expected_completion_at,
    updatedAt: row.updated_at,
    summary: row.summary || {},
    nextAction,
  };
}

async function upsertCustomer(client, { email, name, phone, locale = "en" }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new ApiError("CUSTOMER_EMAIL_REQUIRED");
  const customerCode = await nextCode(client, "CUS");
  const { rows } = await client.query(
    `
      insert into customers (customer_code, email, name, phone, locale)
      values ($1, $2, $3, $4, $5)
      on conflict (email) do update set
        name = coalesce(nullif(excluded.name, ''), customers.name),
        phone = coalesce(excluded.phone, customers.phone),
        locale = excluded.locale,
        updated_at = now()
      returning *
    `,
    [customerCode, normalizedEmail, name || normalizedEmail, phone || null, locale],
  );
  return rows[0];
}

export async function listPublishedStyles() {
  const { rows } = await query(
    `
      select *
      from starter_designs
      where published = true
      order by sort_order asc, style_code asc
    `,
  );
  return rows.map(styleView);
}

export async function getPublishedStyle(styleCode) {
  const { rows } = await query(
    "select * from starter_designs where style_code = $1 and published = true",
    [styleCode],
  );
  if (!rows[0]) throw new ApiError("STYLE_NOT_FOUND", 404);
  return styleView(rows[0]);
}

async function resolveStarterStyleCode(client, value) {
  const requested = typeof value === "string" ? value.trim() : "";
  if (!requested) return null;
  const { rows } = await client.query(
    "select style_code from starter_designs where style_code = $1",
    [requested],
  );
  return rows[0]?.style_code || null;
}

export async function createDraftIntake(payload = {}) {
  return withTransaction(async (client) => {
    // 클라이언트 카탈로그는 styleId, API/DB는 style_code를 사용한다. 두 계약을
    // 경계에서 정규화해 선택한 디자인이 상담 주문으로 유실되지 않게 한다.
    const requestedStyleCode = payload.styleCode || payload.styleId || null;
    // The browser ships a static starter catalog and can be newer than a fresh
    // or partially seeded database. Keep the requested code in form_payload,
    // but only put an existing code in the FK column so a valid intake never
    // degrades into a Postgres 500 solely because catalog seeding lags deploy.
    const styleCode = await resolveStarterStyleCode(client, requestedStyleCode);
    const contactEmail = normalizeEmail(payload.contactEmail || payload.email);
    const customer = contactEmail
      ? await upsertCustomer(client, {
        email: contactEmail,
        name: payload.name || payload.customerName || "",
        phone: payload.contactPhone || payload.phone || "",
        locale: payload.locale || "en",
      })
      : null;
    const intakeCode = await nextCode(client, "IN");
    const { rows } = await client.query(
      `
        insert into customer_intakes (
          intake_code, customer_id, entry_mode, category, product_line, style_code,
          locale, customer_name, contact_email, contact_phone, budget_minor_units,
          currency, required_date, delivery_country, form_payload, reference_media
        ) values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16
        )
        returning *
      `,
      [
        intakeCode,
        customer?.id || null,
        payload.entryMode || (requestedStyleCode ? "design" : "help_me_choose"),
        payload.category || null,
        payload.productLine || null,
        styleCode,
        payload.locale || "en",
        payload.name || payload.customerName || null,
        contactEmail || null,
        payload.contactPhone || payload.phone || null,
        moneyToMinorUnits(payload.budget),
        payload.currency || "USD",
        payload.requiredDate || null,
        payload.deliveryCountry || payload.country || null,
        payload,
        // 왜: node-pg는 JS 배열을 Postgres 배열 리터럴로 직렬화한다 — jsonb 컬럼엔
        // 반드시 stringify (비어있지 않은 referenceMedia가 통째로 500 나던 버그)
        JSON.stringify(payload.referenceMedia || []),
      ],
    );
    return intakeView(rows[0]);
  });
}

function intakeView(row) {
  return {
    intakeId: row.intake_code,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export async function updateDraftIntake(intakeCode, payload = {}) {
  return withTransaction(async (client) => {
    const hasStyleUpdate = Object.hasOwn(payload, "styleCode") || Object.hasOwn(payload, "styleId");
    const linkedStyleCode = hasStyleUpdate
      ? await resolveStarterStyleCode(client, payload.styleCode || payload.styleId || null)
      : null;
    const { rows } = await client.query(
      `
        update customer_intakes
        set
          category = coalesce($2, category),
          product_line = coalesce($3, product_line),
          style_code = case when $4::boolean then $5 else style_code end,
          customer_name = coalesce($6, customer_name),
          contact_email = coalesce($7, contact_email),
          contact_phone = coalesce($8, contact_phone),
          budget_minor_units = coalesce($9, budget_minor_units),
          required_date = coalesce($10, required_date),
          delivery_country = coalesce($11, delivery_country),
          form_payload = form_payload || $12::jsonb,
          reference_media = coalesce($13::jsonb, reference_media),
          version = version + 1,
          updated_at = now()
        where intake_code = $1 and status = 'draft'
        returning *
      `,
      [
        intakeCode,
        payload.category || null,
        payload.productLine || null,
        hasStyleUpdate,
        linkedStyleCode,
        payload.name || payload.customerName || null,
        normalizeEmail(payload.contactEmail || payload.email) || null,
        payload.contactPhone || payload.phone || null,
        moneyToMinorUnits(payload.budget),
        payload.requiredDate || null,
        payload.deliveryCountry || payload.country || null,
        JSON.stringify(payload),
        payload.referenceMedia ? JSON.stringify(payload.referenceMedia) : null,
      ],
    );
    if (!rows[0]) throw new ApiError("INTAKE_NOT_FOUND", 404);
    return intakeView(rows[0]);
  });
}

export async function submitIntake(intakeCode) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "select * from customer_intakes where intake_code = $1 for update",
      [intakeCode],
    );
    const intake = rows[0];
    if (!intake) throw new ApiError("INTAKE_NOT_FOUND", 404);

    const existing = await client.query(
      "select * from customer_orders where intake_id = $1",
      [intake.id],
    );
    if (existing.rows[0]) {
      const c = (await client.query("select email, locale from customers where id = $1", [existing.rows[0].customer_id])).rows[0];
      return { ...orderSummaryView(existing.rows[0]), created: false, notify: { email: c.email, locale: c.locale } };
    }

    const email = normalizeEmail(intake.contact_email || intake.form_payload?.contactEmail || intake.form_payload?.email);
    const customer = intake.customer_id
      ? (await client.query("select * from customers where id = $1", [intake.customer_id])).rows[0]
      : await upsertCustomer(client, {
        email,
        name: intake.customer_name || intake.form_payload?.name || email,
        phone: intake.contact_phone || intake.form_payload?.phone || "",
        locale: intake.locale,
      });

    if (!customer) throw new ApiError("CUSTOMER_EMAIL_REQUIRED");

    const orderCode = await nextCode(client, "BD");
    const timelineCode = await nextCode(client, "TL");
    const summary = {
      category: intake.category,
      styleCode: intake.form_payload?.styleCode || intake.form_payload?.styleId || intake.style_code,
      metal: intake.form_payload?.metal,
      heroMedia: intake.form_payload?.heroMedia,
      measurements: intake.form_payload?.conditional || {},
    };
    const orderResult = await client.query(
      `
        insert into customer_orders (
          order_code, customer_id, intake_id, stage, phase, waiting_on, summary
        ) values ($1, $2, $3, 'OPS_REVIEW', 'DEFINE', 'BELOVEDIAMOND', $4)
        returning *
      `,
      [orderCode, customer.id, intake.id, summary],
    );
    const order = orderResult.rows[0];

    await client.query(
      `
        insert into customer_timeline_events (event_code, order_id, title, body)
        values ($1, $2, $3, $4)
      `,
      [timelineCode, order.id, "Request received", "We are reviewing your custom request."],
    );
    await client.query(
      "update customer_intakes set customer_id = $1, status = 'submitted', submitted_at = now(), updated_at = now() where id = $2",
      [customer.id, intake.id],
    );
    await client.query(
      `
        insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
        values ('customer', $1, 'order', $2, 'created', $3)
      `,
      [customer.customer_code, orderCode, order],
    );

    return { ...orderSummaryView(order), created: true, notify: { email: customer.email, locale: customer.locale } };
  });
}

async function requireCustomerByEmail(client, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new ApiError("CUSTOMER_AUTH_REQUIRED", 401);
  const { rows } = await client.query("select * from customers where email = $1", [normalizedEmail]);
  if (!rows[0]) throw new ApiError("CUSTOMER_AUTH_REQUIRED", 401);
  return rows[0];
}

export async function listCustomerOrders(email) {
  return withTransaction(async (client) => {
    const customer = await requireCustomerByEmail(client, email);
    const { rows } = await client.query(
      `
        select o.*, a.action_code, a.kind, a.status as action_status, a.title, a.description,
               a.subject_type, a.subject_version_id, a.due_at, a.allowed_responses
        from customer_orders o
        left join customer_actions a on a.id = o.next_action_id
        where o.customer_id = $1
        order by o.updated_at desc
      `,
      [customer.id],
    );
    return rows.map((row) => orderSummaryView(row, row.action_code ? actionView({
      action_code: row.action_code,
      kind: row.kind,
      status: row.action_status,
      title: row.title,
      description: row.description,
      subject_type: row.subject_type,
      subject_version_id: row.subject_version_id,
      due_at: row.due_at,
      allowed_responses: row.allowed_responses,
    }) : null));
  });
}

export async function getCustomerOrder(orderCode, email) {
  return withTransaction(async (client) => {
    const customer = await requireCustomerByEmail(client, email);
    const orderResult = await client.query(
      "select * from customer_orders where order_code = $1 and customer_id = $2",
      [orderCode, customer.id],
    );
    const order = orderResult.rows[0];
    if (!order) throw new ApiError("ORDER_ACCESS_DENIED", 403);

    // node-postgres는 한 client에서 쿼리를 병렬 실행하지 않는다. pg@9에서 제거될
    // concurrent client.query 호출을 피하고, 짧은 읽기 트랜잭션 안에서 순서대로 읽는다.
    const actions = await client.query(
      "select * from customer_actions where order_id = $1 order by created_at desc",
      [order.id],
    );
    const artifacts = await client.query(
      "select * from published_artifacts where order_id = $1 order by published_at desc",
      [order.id],
    );
    const timeline = await client.query(
      "select * from customer_timeline_events where order_id = $1 and visibility = 'customer' order by created_at desc",
      [order.id],
    );
    const nextAction = actions.rows.find((row) => row.id === order.next_action_id) || actions.rows.find((row) => row.status === "OPEN");

    return {
      ...orderSummaryView(order, actionView(nextAction)),
      defaultShippingAddress: customer.default_address || null,
      phases: phaseViews(order.stage),
      publishedArtifacts: await Promise.all(artifacts.rows.map(readableArtifactView)),
      timeline: timeline.rows.map(timelineView),
      // 응답 이력 요약 — 포털이 "승인됨 → 디파짓 단계" 같은 상태를 도출하는 데 쓴다 (created_at desc)
      actions: actions.rows.map((row) => ({
        kind: row.kind,
        status: row.status,
        response: row.response_payload?.response || null,
        respondedAt: row.responded_at,
      })),
    };
  });
}

// 고객 배송지 저장 — customer_orders.summary.shippingAddress (어드민 상세에도 그대로 노출)
const SHIPPING_FIELDS = ["recipientName", "phone", "addressLine1", "addressLine2", "city", "region", "postalCode", "country", "notes"];
const REQUIRED_SHIPPING_FIELDS = ["recipientName", "phone", "addressLine1", "city", "region", "postalCode", "country"];
const SHIPPING_FIELD_LIMITS = {
  recipientName: 120,
  phone: 40,
  addressLine1: 200,
  addressLine2: 200,
  city: 120,
  region: 120,
  postalCode: 40,
  country: 120,
  notes: 500,
};

function normalizeShippingAddress(address) {
  if (!isPlainObject(address)) throw validationError("shipping address must be an object");
  const clean = {};
  for (const key of SHIPPING_FIELDS) {
    const raw = address[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      throw validationError(`${key} must be a string`);
    }
    const value = String(raw || "").trim();
    if (value.length > SHIPPING_FIELD_LIMITS[key]) throw validationError(`${key} is too long`);
    clean[key] = value;
  }
  for (const key of REQUIRED_SHIPPING_FIELDS) {
    if (!clean[key]) throw validationError(`${key} is required`);
  }
  if (clean.phone.replace(/\D/g, "").length < 7) throw validationError("phone is invalid");
  return clean;
}

function hasCompleteShippingAddress(address) {
  return isPlainObject(address)
    && REQUIRED_SHIPPING_FIELDS.every((key) => typeof address[key] === "string" && address[key].trim());
}

export async function updateOrderShippingAddress(orderCode, email, address = {}) {
  const clean = normalizeShippingAddress(address);
  return withTransaction(async (client) => {
    const customer = await requireCustomerByEmail(client, email);
    const { rows } = await client.query(
      "select id, stage, summary from customer_orders where order_code = $1 and customer_id = $2 for update",
      [orderCode, customer.id],
    );
    const order = rows[0];
    if (!order) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    if (["SHIPPING", "DELIVERED", "CANCELLED"].includes(order.stage)) {
      throw stateConflict("shipping address cannot be changed after shipping starts", "SHIPPING_ADDRESS_LOCKED");
    }
    await client.query(
      "update customer_orders set summary = coalesce(summary, '{}'::jsonb) || $2::jsonb, updated_at = now() where id = $1",
      [order.id, JSON.stringify({ shippingAddress: clean })],
    );
    // 회원 프로필에도 기본 배송지로 저장 — 다음 주문에서 프리필
    await client.query(
      "update customers set default_address = $2::jsonb, updated_at = now() where id = $1",
      [customer.id, JSON.stringify(clean)],
    );
    // 타임라인은 최초 저장에만 — 주소 수정 반복이 이벤트 스팸이 되지 않게
    if (!order.summary?.shippingAddress) {
      await client.query(
        `insert into customer_timeline_events (event_code, order_id, title, body, payload)
         values ($1, $2, $3, $4, $5)`,
        [await nextCode(client, "TL"), order.id, "shipping_address_confirmed", null, { type: "shipping_address_confirmed" }],
      );
    }
    return { ok: true, shippingAddress: clean };
  });
}

// 고객 주문 취소 — 디파짓 전엔 즉시 취소, 입금 후 제작 중엔 취소 "요청"(환불률은 어드민 정책 판단),
// 완성(FINAL_QC) 이후엔 불가. 완성품은 환불 대상이 아니다.
const CANCEL_DIRECT_STAGES = ["OPS_REVIEW", "STONE_SELECTION", "QUOTE", "DEPOSIT"];
const CANCEL_REQUEST_STAGES = ["CAD", "PRODUCTION"];

async function revokeActiveSupplierAssignments(client, orderId) {
  await client.query(`
    update supplier_order_assignments
    set status='revoked', revoked_at=coalesce(revoked_at, now())
    where order_id=$1 and status='active'
  `, [orderId]);
}

export async function cancelOrder(orderCode, email, reason = "") {
  return withTransaction(async (client) => {
    const customer = await requireCustomerByEmail(client, email);
    const { rows } = await client.query(
      "select id, stage from customer_orders where order_code = $1 and customer_id = $2 for update",
      [orderCode, customer.id],
    );
    const order = rows[0];
    if (!order) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    if (order.stage === "CANCELLED") {
      await revokeActiveSupplierAssignments(client, order.id);
      return { ok: true, cancelled: true };
    }
    const cleanReason = String(reason || "").slice(0, 500);
    // DEPOSIT still names the stage after a customer reports a transfer. Treat
    // that state as money-in-flight and route it to an operator instead of
    // immediately closing an order that may already have been paid.
    const depositReported = order.stage === "DEPOSIT"
      && await timelineEventExists(client, order.id, "payment_reported", "deposit");
    if (CANCEL_DIRECT_STAGES.includes(order.stage) && !depositReported) {
      await client.query(
        "update customer_orders set stage = 'CANCELLED', phase = 'CLOSED', waiting_on = 'NONE', next_action_id = null, updated_at = now() where id = $1",
        [order.id],
      );
      await client.query(
        "update customer_actions set status = 'CANCELLED', updated_at = now() where order_id = $1 and status = 'OPEN'",
        [order.id],
      );
      await revokeActiveSupplierAssignments(client, order.id);
      await client.query(
        `insert into customer_timeline_events (event_code, order_id, title, body, payload)
         values ($1, $2, $3, $4, $5)`,
        [await nextCode(client, "TL"), order.id, "order_cancelled", null, { type: "order_cancelled", data: { reason: cleanReason } }],
      );
      return { ok: true, cancelled: true, customerEmail: customer.email, locale: customer.locale };
    }
    if (depositReported || CANCEL_REQUEST_STAGES.includes(order.stage)) {
      if (await timelineEventExists(client, order.id, "cancel_requested")) {
        await revokeActiveSupplierAssignments(client, order.id);
        return { ok: true, requested: true, customerEmail: customer.email, locale: customer.locale };
      }
      await client.query(
        "update customer_orders set waiting_on = 'BELOVEDIAMOND', next_action_id = null, updated_at = now() where id = $1",
        [order.id],
      );
      await client.query(
        "update customer_actions set status = 'CANCELLED', updated_at = now() where order_id = $1 and status = 'OPEN'",
        [order.id],
      );
      await revokeActiveSupplierAssignments(client, order.id);
      await client.query(
        `insert into customer_timeline_events (event_code, order_id, title, body, payload)
         values ($1, $2, $3, $4, $5)`,
        [await nextCode(client, "TL"), order.id, "cancel_requested", null, { type: "cancel_requested", data: { reason: cleanReason } }],
      );
      return { ok: true, requested: true, customerEmail: customer.email, locale: customer.locale };
    }
    throw new ApiError("CANCEL_NOT_ALLOWED", 400, "finished pieces are not refundable");
  });
}

async function latestArtifact(client, orderId, type) {
  const { rows } = await client.query(
    `select * from published_artifacts
     where order_id = $1 and type = $2
     order by published_at desc, id desc limit 1`,
    [orderId, type],
  );
  return rows[0] || null;
}

async function latestActionOfKind(client, orderId, kind) {
  const { rows } = await client.query(
    `select * from customer_actions
     where order_id = $1 and kind = $2
     order by created_at desc, id desc limit 1`,
    [orderId, kind],
  );
  return rows[0] || null;
}

async function timelineEventExists(client, orderId, type, paymentKind = null) {
  const params = [orderId, type];
  let kindClause = "";
  if (paymentKind) {
    params.push(paymentKind);
    kindClause = "and payload #>> '{data,kind}' = $3";
  }
  const { rows } = await client.query(
    `select 1 from customer_timeline_events
     where order_id = $1 and payload->>'type' = $2 ${kindClause}
     limit 1`,
    params,
  );
  return Boolean(rows[0]);
}

function actionResponse(action) {
  return action?.status === "RESPONDED" ? action.response_payload?.response : null;
}

// 고객 송금 셀프 리포트 (deposit|balance) — 타임라인 기록 + 공은 BeloveD로
export async function reportOrderPayment(orderCode, email, kind) {
  if (kind !== "deposit" && kind !== "balance") {
    throw validationError("kind must be deposit or balance");
  }
  const paymentKind = kind;
  return withTransaction(async (client) => {
    const customer = await requireCustomerByEmail(client, email);
    const { rows } = await client.query(
      "select id, stage, summary from customer_orders where order_code = $1 and customer_id = $2 for update",
      [orderCode, customer.id],
    );
    const order = rows[0];
    if (!order) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    // 주문 행 잠금 뒤 중복을 확인하므로 동시 더블클릭도 한 건만 기록된다.
    if (await timelineEventExists(client, order.id, "payment_reported", paymentKind)) {
      throw stateConflict(`${paymentKind} payment has already been reported`, "PAYMENT_ALREADY_REPORTED");
    }

    const expectedStage = paymentKind === "deposit" ? "DEPOSIT" : "BALANCE";
    if (order.stage !== expectedStage) {
      throw stateConflict(`${paymentKind} payment cannot be reported from ${order.stage}`);
    }
    if (paymentKind === "deposit") {
      const quote = await latestArtifact(client, order.id, "QUOTE");
      const quoteAction = await latestActionOfKind(client, order.id, "QUOTE_ACCEPTANCE");
      if (!quote || !(Number(quote.payload?.totalUsd) > 0) || actionResponse(quoteAction) !== "APPROVE") {
        throw stateConflict("an approved quote with a total is required", "ORDER_PREREQUISITE_MISSING");
      }
      if (!hasCompleteShippingAddress(order.summary?.shippingAddress)) {
        throw stateConflict("a complete shipping address is required before reporting the deposit", "ORDER_PREREQUISITE_MISSING");
      }
    } else {
      const qcAction = await latestActionOfKind(client, order.id, "FINAL_QC_CONFIRMATION");
      if (actionResponse(qcAction) !== "CONFIRM" || !(await timelineEventExists(client, order.id, "balance_requested"))) {
        throw stateConflict("confirmed QC and a balance request are required", "ORDER_PREREQUISITE_MISSING");
      }
    }
    await client.query(
      `insert into customer_timeline_events (event_code, order_id, title, body, payload)
       values ($1, $2, $3, $4, $5)`,
      [await nextCode(client, "TL"), order.id, "payment_reported", null, { type: "payment_reported", data: { kind: paymentKind } }],
    );
    await client.query(
      "update customer_orders set waiting_on = 'BELOVEDIAMOND', updated_at = now() where id = $1",
      [order.id],
    );
    return { ok: true, kind: paymentKind };
  });
}

export async function listOrderActions(orderCode, email) {
  const order = await getCustomerOrder(orderCode, email);
  return {
    orderCode: order.orderCode,
    actions: [order.nextAction, ...[]].filter(Boolean),
  };
}

export async function respondToAction(actionCode, email, payload = {}) {
  return withTransaction(async (client) => {
    const customer = await requireCustomerByEmail(client, email);
    const { rows } = await client.query(
      `
        select a.*, o.customer_id, o.order_code, o.stage as order_stage,
               o.next_action_id as order_next_action_id
        from customer_actions a
        join customer_orders o on o.id = a.order_id
        where a.action_code = $1
        for update of a, o
      `,
      [actionCode],
    );
    const action = rows[0];
    if (!action || action.customer_id !== customer.id) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    if (action.status !== "OPEN") throw new ApiError("ACTION_STALE", 409);
    if (action.order_next_action_id !== action.id) throw new ApiError("ACTION_STALE", 409);
    if (payload.expectedSubjectVersionId && payload.expectedSubjectVersionId !== action.subject_version_id) {
      throw new ApiError("ACTION_STALE", 409);
    }

    const response = payload.response;
    if (typeof response !== "string" || !response) throw validationError("response is required");
    if (!Array.isArray(action.allowed_responses) || !action.allowed_responses.includes(response)) {
      throw validationError("response is not allowed");
    }
    if (response === "REQUEST_CHANGES" && (typeof payload.message !== "string" || !payload.message.trim())) {
      throw validationError("message is required when requesting changes");
    }

    if (action.kind === "QUOTE_ACCEPTANCE") {
      if (action.order_stage !== "QUOTE") throw new ApiError("ACTION_STALE", 409);
      const quote = await latestArtifact(client, action.order_id, "QUOTE");
      const total = Number(quote?.payload?.totalUsd);
      if (!quote || !(total > 0) || !Number.isFinite(total) || action.subject_version_id !== quote.artifact_code) {
        throw stateConflict("the current quote must include a valid total", "ORDER_PREREQUISITE_MISSING");
      }
    }
    if (action.kind === "CAD_REVIEW") {
      if (action.order_stage !== "CAD") throw new ApiError("ACTION_STALE", 409);
      const cad = await latestArtifact(client, action.order_id, "CAD");
      if (!cad || !Array.isArray(cad.media) || cad.media.length === 0 || action.subject_version_id !== cad.artifact_code) {
        throw stateConflict("the current CAD media is required", "ORDER_PREREQUISITE_MISSING");
      }
    }
    if (action.kind === "FINAL_QC_CONFIRMATION") {
      if (action.order_stage !== "FINAL_QC") throw new ApiError("ACTION_STALE", 409);
      const qc = await latestArtifact(client, action.order_id, "QC");
      if (!qc || !Array.isArray(qc.media) || qc.media.length === 0 || action.subject_version_id !== qc.artifact_code) {
        throw stateConflict("the current QC media is required", "ORDER_PREREQUISITE_MISSING");
      }
    }

    await client.query(
      `
        update customer_actions
        set status = 'RESPONDED', response_payload = $2, responded_at = now(), updated_at = now()
        where id = $1
      `,
      [action.id, payload],
    );
    const assignment = (await client.query(`
      select * from supplier_order_assignments
      where order_id=$1 and status='active'
      order by assigned_at desc limit 1 for update
    `, [action.order_id])).rows[0];

    let supplierWorkflowState = null;
    if (assignment) {
      if (action.kind === "QUOTE_ACCEPTANCE" && response === "APPROVE"
        && assignment.workflow_state === "QUOTE_CUSTOMER_REVIEW") {
        supplierWorkflowState = "DEPOSIT_REQUIRED";
      }
      if (action.kind === "CAD_REVIEW" && assignment.workflow_state === "CUSTOMER_CAD_REVIEW") {
        supplierWorkflowState = response === "APPROVE" ? "DESIGN_APPROVED" : "DESIGN_CHANGES";
      }
      if (action.kind === "FINAL_QC_CONFIRMATION" && assignment.workflow_state === "CUSTOMER_QC_REVIEW") {
        supplierWorkflowState = response === "CONFIRM" ? "QC_APPROVED" : "QC_CHANGES";
      }
      if (supplierWorkflowState) {
        await client.query(
          "update supplier_order_assignments set workflow_state=$2 where id=$1",
          [assignment.id, supplierWorkflowState],
        );
      }
      if (response === "REQUEST_CHANGES" && new Set(["CAD_REVIEW", "FINAL_QC_CONFIRMATION"]).has(action.kind)) {
        const updateType = action.kind === "CAD_REVIEW" ? "CAD" : "QC";
        await client.query(`
          update supplier_updates
          set review_status='changes_requested', review_note=$4, reviewed_at=now()
          where id=(
            select id from supplier_updates
            where supplier_id=$1 and order_id=$2 and update_type=$3
            order by version desc, created_at desc limit 1
          )
        `, [assignment.supplier_id, action.order_id, updateType, payload.message.trim()]);
      }
    }
    // Keep the customer-order projection compatible with the supplier state in
    // the same transaction. Customer approval/change requests often hand the
    // next action back to the vendor, not BeloveD.
    const quoteApproved = action.kind === "QUOTE_ACCEPTANCE" && response === "APPROVE";
    if (supplierWorkflowState) {
      await syncCustomerOrderToSupplierWorkflow(client, action.order_id, supplierWorkflowState);
      await client.query(
        "update customer_orders set next_action_id=null, updated_at=now() where id=$1",
        [action.order_id],
      );
    } else if (quoteApproved) {
      await client.query(
        `
          update customer_orders
          set stage = 'DEPOSIT', waiting_on = 'CUSTOMER', next_action_id = null, updated_at = now()
          where id = $1
        `,
        [action.order_id],
      );
    } else {
      await client.query(
        `
          update customer_orders
          set waiting_on = 'BELOVEDIAMOND', next_action_id = null, updated_at = now()
          where id = $1
        `,
        [action.order_id],
      );
    }
    await client.query(
      `
        insert into customer_timeline_events (event_code, order_id, title, body)
        values ($1, $2, $3, $4)
      `,
      [await nextCode(client, "TL"), action.order_id, "Response received", action.title],
    );
    return { actionId: actionCode, status: "RESPONDED", supplierWorkflowState };
  });
}

export async function createUploadSession(payload = {}) {
  return withTransaction(async (client) => {
    const mediaCode = await nextCode(client, "MED");
    const storageKey = `customer/${mediaCode}`;
    await client.query(
      `
        insert into media_assets (media_code, kind, mime_type, byte_size, storage_key, public_payload)
        values ($1, $2, $3, $4, $5, $6)
      `,
      [
        mediaCode,
        payload.kind || "image",
        payload.mimeType || "application/octet-stream",
        payload.byteSize || null,
        storageKey,
        { fileName: payload.fileName || null },
      ],
    );
    return {
      mediaId: mediaCode,
      uploadUrl: `/v1/customer/media/${mediaCode}/mock-upload`,
      method: "PUT",
      expiresInSeconds: 900,
    };
  });
}

export function requestHash(body) {
  return createHash("sha256").update(JSON.stringify(body || {})).digest("hex");
}

export async function runIdempotent(route, key, hash, fn) {
  if (!key) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED", 400);
  return withTransaction(async (client) => {
    const existing = await client.query(
      "select * from idempotency_keys where route = $1 and idempotency_key = $2",
      [route, key],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== hash) throw new ApiError("IDEMPOTENCY_KEY_REUSED", 409);
      return {
        statusCode: existing.rows[0].status_code,
        body: existing.rows[0].response_json,
      };
    }

    const result = await fn(client);
    await client.query(
      `
        insert into idempotency_keys (route, idempotency_key, request_hash, status_code, response_json)
        values ($1, $2, $3, $4, $5)
      `,
      [route, key, hash, result.statusCode || 200, result.body || result],
    );
    return {
      statusCode: result.statusCode || 200,
      body: result.body || result,
    };
  });
}

// 주문 상태 이벤트 — 스펙 §2 전이 표. received는 인테이크 제출이 자동 기록(라우트는 거부).
export const EVENT_TRANSITIONS = {
  received: { stage: "OPS_REVIEW", phase: "DEFINE", waitingOn: "BELOVEDIAMOND" },
  proposal_sent: { stage: "QUOTE", phase: "DEFINE", waitingOn: "CUSTOMER" },
  deposit_confirmed: { stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "BELOVEDIAMOND" },
  diamond_locked: { stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "BELOVEDIAMOND" },
  cad_ready: { stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "CUSTOMER" },
  production_started: { stage: "PRODUCTION", phase: "MAKING", waitingOn: "BELOVEDIAMOND" },
  qc_ready: { stage: "FINAL_QC", phase: "MAKING", waitingOn: "CUSTOMER" },
  balance_requested: { stage: "BALANCE", phase: "DELIVERY", waitingOn: "CUSTOMER" },
  balance_confirmed: { stage: "BALANCE", phase: "DELIVERY", waitingOn: "BELOVEDIAMOND" },
  order_cancelled: { stage: "CANCELLED", phase: "CLOSED", waitingOn: "NONE" },
  shipped: { stage: "SHIPPING", phase: "DELIVERY", waitingOn: "EXTERNAL" },
  delivered: { stage: "DELIVERED", phase: "CLOSED", waitingOn: "NONE" },
};

// 이벤트에 실어 보낼 수 있는 발행물 — 스키마 check 제약과 동일 목록 (사전 검증으로 500 대신 400)
const ARTIFACT_TYPES = new Set(["REFERENCE", "DIAMOND_OPTION", "QUOTE", "CAD", "QC", "CERTIFICATE", "SHIPMENT"]);
const ACTION_KINDS = new Set([
  "DIAMOND_SELECTION", "QUOTE_ACCEPTANCE", "CAD_REVIEW", "FINAL_WEIGHT_ACCEPTANCE",
  "FINAL_QC_CONFIRMATION", "DELIVERY_ADDRESS",
]);

const EVENT_ALLOWED_STAGES = {
  proposal_sent: ["OPS_REVIEW", "STONE_SELECTION", "QUOTE"],
  deposit_confirmed: ["DEPOSIT"],
  diamond_locked: ["CAD"],
  cad_ready: ["CAD"],
  production_started: ["CAD"],
  qc_ready: ["PRODUCTION", "FINAL_QC"],
  balance_requested: ["FINAL_QC"],
  balance_confirmed: ["BALANCE"],
  order_cancelled: ["OPS_REVIEW", "STONE_SELECTION", "QUOTE", "DEPOSIT", "CAD", "PRODUCTION", "FINAL_QC", "BALANCE"],
  shipped: ["BALANCE"],
  delivered: ["SHIPPING"],
};

function normalizeArtifact(artifact) {
  if (!isPlainObject(artifact)) throw validationError("artifact must be an object");
  if (!ARTIFACT_TYPES.has(artifact.type)) throw validationError("unknown artifact type");
  if (artifact.payload !== undefined && !isPlainObject(artifact.payload)) throw validationError("artifact.payload must be an object");
  if (artifact.media !== undefined && !Array.isArray(artifact.media)) throw validationError("artifact.media must be an array");
  const media = (artifact.media || []).map((item, index) => {
    if (!isPlainObject(item)) throw validationError(`artifact.media[${index}] must be an object`);
    const src = cleanRequiredText(item.src, `artifact.media[${index}].src`, 2_000);
    try {
      const parsed = new URL(src);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
    } catch {
      throw validationError(`artifact.media[${index}].src must be an http(s) URL`);
    }
    return { ...item, src };
  });
  if (media.length > 5) throw validationError("artifact.media supports at most 5 items");
  return { ...artifact, payload: { ...(artifact.payload || {}) }, media };
}

function normalizeAction(action) {
  if (!isPlainObject(action)) throw validationError("action must be an object");
  if (!ACTION_KINDS.has(action.kind)) throw validationError("unknown action kind");
  if (!Array.isArray(action.allowedResponses) || action.allowedResponses.length === 0) {
    throw validationError("action.allowedResponses must be a non-empty array");
  }
  const allowedResponses = action.allowedResponses.map((response, index) => (
    cleanRequiredText(response, `action.allowedResponses[${index}]`, 80)
  ));
  if (new Set(allowedResponses).size !== allowedResponses.length) {
    throw validationError("action.allowedResponses must not contain duplicates");
  }
  return { ...action, allowedResponses };
}

function requireActionResponses(action, required, allowed, eventType) {
  const responses = action?.allowedResponses || [];
  if (!required.every((response) => responses.includes(response))
      || responses.some((response) => !allowed.includes(response))) {
    throw validationError(`${eventType} has invalid allowed responses`);
  }
}

function validateOrderEventInput(type, data, extras) {
  if (!isPlainObject(data)) throw validationError("data must be an object");
  if (!isPlainObject(extras)) throw validationError("event extras must be an object");
  const cleanData = { ...data };
  const cleanExtras = {
    artifact: extras.artifact === undefined ? null : normalizeArtifact(extras.artifact),
    action: extras.action === undefined ? null : normalizeAction(extras.action),
  };
  const artifactEvents = new Set(["proposal_sent", "cad_ready", "qc_ready", "shipped"]);
  const actionEvents = new Set(["proposal_sent", "cad_ready", "qc_ready"]);
  if (cleanExtras.artifact && !artifactEvents.has(type)) throw validationError(`${type} does not accept an artifact`);
  if (cleanExtras.action && !actionEvents.has(type)) throw validationError(`${type} does not accept an action`);

  if (type === "proposal_sent") {
    if (cleanExtras.artifact?.type !== "QUOTE") throw validationError("proposal_sent requires a QUOTE artifact");
    const total = positiveMoney(cleanExtras.artifact.payload.totalUsd, "artifact.payload.totalUsd");
    cleanExtras.artifact.payload.totalUsd = total;
    if (cleanExtras.artifact.payload.depositUsd !== undefined && cleanExtras.artifact.payload.depositUsd !== null && cleanExtras.artifact.payload.depositUsd !== "") {
      const deposit = positiveMoney(cleanExtras.artifact.payload.depositUsd, "artifact.payload.depositUsd");
      if (deposit >= total) throw validationError("artifact.payload.depositUsd must be less than totalUsd");
      cleanExtras.artifact.payload.depositUsd = deposit;
    }
    if (cleanExtras.action?.kind !== "QUOTE_ACCEPTANCE") throw validationError("proposal_sent requires a QUOTE_ACCEPTANCE action");
    requireActionResponses(cleanExtras.action, ["APPROVE"], ["APPROVE", "REQUEST_CHANGES"], "proposal_sent");
  }
  if (type === "diamond_locked") cleanData.igi = cleanRequiredText(cleanData.igi, "data.igi", 120);
  if (type === "cad_ready") {
    if (cleanExtras.artifact?.type !== "CAD" || cleanExtras.artifact.media.length === 0) {
      throw validationError("cad_ready requires CAD media");
    }
    if (cleanExtras.action?.kind !== "CAD_REVIEW") throw validationError("cad_ready requires a CAD_REVIEW action");
    requireActionResponses(cleanExtras.action, ["APPROVE"], ["APPROVE", "REQUEST_CHANGES"], "cad_ready");
  }
  if (type === "qc_ready") {
    if (cleanExtras.artifact?.type !== "QC" || cleanExtras.artifact.media.length === 0) {
      throw validationError("qc_ready requires QC media");
    }
    if (cleanExtras.action?.kind !== "FINAL_QC_CONFIRMATION") throw validationError("qc_ready requires a FINAL_QC_CONFIRMATION action");
    requireActionResponses(cleanExtras.action, ["CONFIRM"], ["CONFIRM", "REQUEST_CHANGES"], "qc_ready");
  }
  if (type === "shipped") {
    cleanData.tracking = cleanRequiredText(cleanData.tracking, "data.tracking", 160);
    if (cleanExtras.artifact && cleanExtras.artifact.type !== "SHIPMENT") {
      throw validationError("shipped only accepts a SHIPMENT artifact");
    }
    if (cleanExtras.artifact) cleanExtras.artifact.payload.tracking = cleanData.tracking;
  }
  if ((type === "deposit_confirmed" || type === "balance_confirmed") && cleanData.amountUsd !== undefined) {
    cleanData.amountUsd = positiveMoney(cleanData.amountUsd, "data.amountUsd");
  }
  if (type === "order_cancelled" && cleanData.refundNote !== undefined) {
    if (typeof cleanData.refundNote !== "string" || cleanData.refundNote.length > 500) {
      throw validationError("data.refundNote must be a string of at most 500 characters");
    }
    cleanData.refundNote = cleanData.refundNote.trim();
  }
  return { data: cleanData, extras: cleanExtras };
}

// extras.artifact: 고객 포털에 공개할 미디어/페이로드, extras.action: 열릴 고객 컨펌.
// 같은 트랜잭션에서 stage 전이와 함께 원자적으로 발행된다 — 절반만 적용되는 상태 없음.
export async function recordOrderEvent(orderCode, type, data = {}, extras = {}) {
  // 왜: EVENT_TRANSITIONS[type]는 상속된 Object.prototype 속성명("toString" 등)도 truthy로 통과시킨다 — own-property로만 검사
  const transition = Object.hasOwn(EVENT_TRANSITIONS, type) ? EVENT_TRANSITIONS[type] : null;
  if (!transition) throw validationError(`unknown event type: ${type}`);
  const normalized = validateOrderEventInput(type, data, extras);
  const eventData = normalized.data;
  const eventExtras = normalized.extras;
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select o.*, c.email, c.locale from customer_orders o
       join customers c on c.id = o.customer_id
       where o.order_code = $1 for update of o`,
      [orderCode],
    );
    const order = rows[0];
    if (!order) throw new ApiError("NOT_FOUND", 404);

    const cancellationPending = await timelineEventExists(client, order.id, "cancel_requested");
    if (cancellationPending && type !== "order_cancelled") {
      throw stateConflict("the cancellation request must be resolved before advancing the order", "CANCELLATION_PENDING");
    }

    if (!EVENT_ALLOWED_STAGES[type]?.includes(order.stage)) {
      throw stateConflict(`${type} cannot be applied from ${order.stage}`);
    }

    // 재발행은 고객이 최신 버전의 변경을 요청한 제안/QC/CAD에만 허용한다.
    // 그 밖의 이벤트는 주문 행 잠금 아래 단 한 번만 기록된다.
    const repeatableKind = type === "proposal_sent"
      ? "QUOTE_ACCEPTANCE"
      : type === "qc_ready"
        ? "FINAL_QC_CONFIRMATION"
        : type === "cad_ready" ? "CAD_REVIEW" : null;
    if (repeatableKind && ["QUOTE", "FINAL_QC", "CAD"].includes(order.stage)) {
      const previousAction = await latestActionOfKind(client, order.id, repeatableKind);
      if (previousAction && actionResponse(previousAction) !== "REQUEST_CHANGES") {
        throw stateConflict(`${type} is already awaiting a customer response`, "EVENT_ALREADY_RECORDED");
      }
    } else if (await timelineEventExists(client, order.id, type)) {
      throw stateConflict(`${type} has already been recorded`, "EVENT_ALREADY_RECORDED");
    }

    if (type === "deposit_confirmed") {
      const quote = await latestArtifact(client, order.id, "QUOTE");
      const quoteAction = await latestActionOfKind(client, order.id, "QUOTE_ACCEPTANCE");
      if (!quote || !(Number(quote.payload?.totalUsd) > 0) || actionResponse(quoteAction) !== "APPROVE") {
        throw stateConflict("an approved quote with a total is required", "ORDER_PREREQUISITE_MISSING");
      }
      if (!(await timelineEventExists(client, order.id, "payment_reported", "deposit"))) {
        throw stateConflict("the customer must report the deposit first", "PAYMENT_REPORT_REQUIRED");
      }
    }
    if (type === "diamond_locked" && !(await timelineEventExists(client, order.id, "deposit_confirmed"))) {
      throw stateConflict("the deposit must be confirmed first", "ORDER_PREREQUISITE_MISSING");
    }
    if (type === "cad_ready" && !(await timelineEventExists(client, order.id, "diamond_locked"))) {
      throw stateConflict("the diamond must be locked first", "ORDER_PREREQUISITE_MISSING");
    }
    if (type === "production_started") {
      if (!(await timelineEventExists(client, order.id, "deposit_confirmed")) || !(await timelineEventExists(client, order.id, "diamond_locked"))) {
        throw stateConflict("confirmed deposit and locked diamond are required", "ORDER_PREREQUISITE_MISSING");
      }
      if (await timelineEventExists(client, order.id, "cad_ready")) {
        const cadAction = await latestActionOfKind(client, order.id, "CAD_REVIEW");
        if (actionResponse(cadAction) !== "APPROVE") {
          throw stateConflict("the latest CAD must be approved first", "ORDER_PREREQUISITE_MISSING");
        }
      }
    }
    if (type === "qc_ready" && !(await timelineEventExists(client, order.id, "production_started"))) {
      throw stateConflict("production must start before QC", "ORDER_PREREQUISITE_MISSING");
    }
    if (type === "balance_requested") {
      const qc = await latestArtifact(client, order.id, "QC");
      const qcAction = await latestActionOfKind(client, order.id, "FINAL_QC_CONFIRMATION");
      if (!qc || !Array.isArray(qc.media) || qc.media.length === 0 || actionResponse(qcAction) !== "CONFIRM") {
        throw stateConflict("QC media and customer confirmation are required", "ORDER_PREREQUISITE_MISSING");
      }
    }
    if (type === "balance_confirmed") {
      if (!(await timelineEventExists(client, order.id, "balance_requested"))) {
        throw stateConflict("the balance must be requested first", "ORDER_PREREQUISITE_MISSING");
      }
      if (!(await timelineEventExists(client, order.id, "payment_reported", "balance"))) {
        throw stateConflict("the customer must report the balance first", "PAYMENT_REPORT_REQUIRED");
      }
    }
    let refundRecord = null;
    if (type === "order_cancelled") {
      const payments = Array.isArray(order.summary?.payments) ? order.summary.payments : [];
      const paidMinor = payments.reduce((sum, payment) => {
        const value = moneyToMinorUnits(payment.amountUsd);
        return sum + (Number.isInteger(value) && value > 0 ? value : 0);
      }, 0);
      const transferReported = await timelineEventExists(client, order.id, "payment_reported", "deposit")
        || await timelineEventExists(client, order.id, "payment_reported", "balance");
      if (await timelineEventExists(client, order.id, "balance_confirmed")) {
        throw stateConflict("a fully paid order cannot be cancelled without a dedicated refund workflow");
      }
      if ((paidMinor > 0 || transferReported) && !eventData.refundNote) {
        throw validationError("data.refundNote is required after a transfer is reported or confirmed");
      }
      if (paidMinor > 0) {
        eventData.refundAmountUsd = paidMinor / 100;
        refundRecord = {
          amountUsd: paidMinor / 100,
          note: eventData.refundNote,
          at: new Date().toISOString(),
        };
      }
    }
    if (type === "shipped") {
      if (!(await timelineEventExists(client, order.id, "balance_confirmed"))) {
        throw stateConflict("the balance must be confirmed first", "ORDER_PREREQUISITE_MISSING");
      }
      if (!hasCompleteShippingAddress(order.summary?.shippingAddress)) {
        throw stateConflict("a complete shipping address is required", "ORDER_PREREQUISITE_MISSING");
      }
    }
    if (type === "delivered") {
      if (!(await timelineEventExists(client, order.id, "shipped")) || !String(order.summary?.tracking || "").trim()) {
        throw stateConflict("the order must be shipped with tracking first", "ORDER_PREREQUISITE_MISSING");
      }
    }

    // 제안에 별도 디파짓 금액이 없으면 서버 운영 설정을 스냅샷으로 저장한다.
    // 이후 포털·영수증 모두 같은 QUOTE payload를 보므로 설정 변경에도 기존 주문은 안정적이다.
    if (type === "proposal_sent" && eventExtras.artifact.payload.depositUsd === undefined) {
      const rate = await configuredDepositRate(client);
      eventExtras.artifact.payload.depositRate = rate;
      eventExtras.artifact.payload.depositUsd = computedDeposit(eventExtras.artifact.payload.totalUsd, rate);
    }
    const eventCode = await nextCode(client, "TL");
    await client.query(
      `insert into customer_timeline_events (event_code, order_id, title, body, payload)
       values ($1, $2, $3, $4, $5)`,
      [eventCode, order.id, type, null, { type, data: eventData }],
    );
    await client.query(
      `update customer_orders set stage = $2, phase = $3, waiting_on = $4, updated_at = now()
       where id = $1`,
      [order.id, transition.stage, transition.phase, transition.waitingOn],
    );
    const supplierEventTransition = {
      proposal_sent: { from: "ESTIMATE_APPROVED", to: "QUOTE_CUSTOMER_REVIEW" },
      deposit_confirmed: { from: "DEPOSIT_REQUIRED", to: "DESIGN_REQUIRED" },
      production_started: { from: "DESIGN_APPROVED", to: "IN_PRODUCTION" },
    }[type];
    if (supplierEventTransition) {
      const supplierAssignments = await client.query(`
        update supplier_order_assignments set workflow_state=$3
        where order_id=$1 and status='active' and workflow_state=$2
        returning id, workflow_state
      `, [order.id, supplierEventTransition.from, supplierEventTransition.to]);
      if (supplierAssignments.rows[0]) {
        await syncCustomerOrderToSupplierWorkflow(
          client,
          order.id,
          supplierAssignments.rows[0].workflow_state,
        );
      }
    }
    if (type === "order_cancelled") {
      await revokeActiveSupplierAssignments(client, order.id);
      await client.query(
        "update customer_actions set status = 'CANCELLED', updated_at = now() where order_id = $1 and status = 'OPEN'",
        [order.id],
      );
      await client.query("update customer_orders set next_action_id = null where id = $1", [order.id]);
      if (refundRecord) {
        const refunds = [...(Array.isArray(order.summary?.refunds) ? order.summary.refunds : []), refundRecord];
        await client.query(
          `update customer_orders
           set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('refunds', $2::jsonb)
           where id = $1`,
          [order.id, JSON.stringify(refunds)],
        );
      }
    }
    // 운송장은 타임라인 payload에만 두면 조회가 어렵다 — 리뷰 인증(주문번호+운송장)이 summary에서 읽는다
    if (type === "shipped") {
      await client.query(
        `update customer_orders set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('tracking', $2::text)
         where id = $1`,
        [order.id, eventData.tracking],
      );
    }

    // 결제 확인(디파짓/잔금) — 최신 견적(QUOTE)에서 금액을 확정해 summary.payments에 영수증으로 남긴다.
    // 메일 영수증 블록과 포털 결제 내역이 같은 숫자를 보는 단일 소스. data.amountUsd로 어드민 수동 override 가능.
    let receipt = null;
    if (type === "deposit_confirmed" || type === "balance_confirmed") {
      const quote = await latestArtifact(client, order.id, "QUOTE");
      const qp = quote?.payload || {};
      const total = positiveMoney(qp.totalUsd, "quote totalUsd");
      const totalMinor = moneyToMinorUnits(total);
      const depositRate = normalizedDepositRate(qp.depositRate ?? await configuredDepositRate(client));
      const deposit = Number(qp.depositUsd) > 0
        ? positiveMoney(qp.depositUsd, "quote depositUsd")
        : computedDeposit(total, depositRate);
      const depositMinor = moneyToMinorUnits(deposit);
      if (depositMinor >= totalMinor) throw validationError("quote depositUsd must be less than totalUsd");

      const prior = (Array.isArray(order.summary?.payments) ? order.summary.payments : []).filter((p) => p.kind !== type);
      const alreadyPaidMinor = prior.reduce((sum, payment) => {
        const value = moneyToMinorUnits(payment.amountUsd);
        return sum + (Number.isInteger(value) && value > 0 ? value : 0);
      }, 0);
      const remainingMinor = Math.max(0, totalMinor - alreadyPaidMinor);
      const fallbackMinor = type === "deposit_confirmed" ? depositMinor : remainingMinor;
      const amountMinor = eventData.amountUsd !== undefined
        ? moneyToMinorUnits(eventData.amountUsd)
        : fallbackMinor;
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        throw validationError(`${type} requires a positive receipt amount`);
      }
      if (amountMinor > remainingMinor) throw validationError("data.amountUsd exceeds the remaining order total");
      if (type === "balance_confirmed" && amountMinor !== remainingMinor) {
        throw validationError("data.amountUsd must equal the remaining order total");
      }

      const amount = amountMinor / 100;
      const payments = [...prior, { kind: type, amountUsd: amount, at: new Date().toISOString() }];
      const paidMinor = alreadyPaidMinor + amountMinor;
      receipt = {
        kind: type,
        amountUsd: amount,
        totalUsd: total,
        paidUsd: paidMinor / 100,
        remainingUsd: Math.max(0, totalMinor - paidMinor) / 100,
      };
      await client.query(
        `update customer_orders set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('payments', $2::jsonb)
         where id = $1`,
        [order.id, JSON.stringify(payments)],
      );
    }

    let artifactCode = null;
    if (eventExtras.artifact) {
      const a = eventExtras.artifact;
      artifactCode = await nextCode(client, "ART");
      // 버전 자동 증가 — 수정 제안 재발송이 V1으로 남으면 고객·어드민 모두 몇 번째 안인지 알 수 없다
      const { rows: verRows } = await client.query(
        "select count(*)::int as n from published_artifacts where order_id = $1 and type = $2",
        [order.id, a.type],
      );
      const versionLabel = a.versionLabel || `V${(verRows[0]?.n || 0) + 1}`;
      await client.query(
        `insert into published_artifacts (artifact_code, order_id, type, version_label, subject_version_id, payload, media)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [artifactCode, order.id, a.type, versionLabel, a.subjectVersionId || artifactCode,
          a.payload || {}, JSON.stringify(a.media || [])],
      );
    }

    let actionCode = null;
    if (eventExtras.action) {
      const act = eventExtras.action;
      // 한 번에 열린 컨펌은 하나 — 이전 열린 액션은 취소하고 새 액션을 다음 액션으로 지정
      await client.query(
        "update customer_actions set status = 'CANCELLED', updated_at = now() where order_id = $1 and status = 'OPEN'",
        [order.id],
      );
      actionCode = await nextCode(client, "ACT");
      const inserted = await client.query(
        `insert into customer_actions (action_code, order_id, kind, title, description, subject_type, subject_version_id, due_at, allowed_responses)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [actionCode, order.id, act.kind, act.title || type, act.description || null,
          act.subjectType || eventExtras.artifact?.type || "ORDER",
          artifactCode || act.subjectVersionId || orderCode,
          act.dueAt || null, act.allowedResponses || []],
      );
      await client.query(
        "update customer_orders set next_action_id = $2, updated_at = now() where id = $1",
        [order.id, inserted.rows[0].id],
      );
    }

    await client.query(
      `insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, before_json, after_json)
       values ('admin', null, 'order', $1, $2, $3, $4)`,
      [orderCode, `event:${type}`, { stage: order.stage }, { stage: transition.stage, data: eventData, artifactCode, actionCode }],
    );
    return {
      orderCode, stage: transition.stage, eventId: eventCode, artifactCode, actionCode, receipt,
      notify: { email: order.email, locale: order.locale },
    };
  });
}

// 어드민 실주문 콘솔 — 서버 주문 목록. 어드민 전용이라 고객 이메일 노출 허용.
// 최근 갱신 순, 진행 중 주문을 위로 (CLOSED/CANCELLED는 뒤).
export async function listServerOrders({ limit = 100 } = {}) {
  const { rows } = await query(
    `select o.order_code, o.stage, o.phase, o.waiting_on, o.created_at, o.updated_at, o.summary,
            c.name as customer_name, c.email as customer_email, c.locale,
            (
              select case
                when pa.payload->>'totalUsd' ~ '^[0-9]+([.][0-9]+)?$' then (pa.payload->>'totalUsd')::numeric
                else null
              end
              from published_artifacts pa
              where pa.order_id = o.id and pa.type = 'QUOTE' and pa.payload ? 'totalUsd'
              order by pa.published_at desc, pa.id desc
              limit 1
            ) as total_usd
     from customer_orders o
     join customers c on c.id = o.customer_id
     order by (o.phase = 'CLOSED' or o.stage = 'CANCELLED'), o.updated_at desc
     limit $1`,
    [Math.min(Number(limit) || 100, 500)],
  );
  return rows.map((r) => ({
    orderCode: r.order_code,
    stage: r.stage,
    phase: r.phase,
    waitingOn: r.waiting_on,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    summary: r.summary || {},
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    locale: r.locale,
    // 최신 QUOTE 아티팩트의 총액 — Past Orders 매출 집계용 (견적 전 주문은 null)
    totalUsd: r.total_usd === null ? null : Number(r.total_usd),
  }));
}
