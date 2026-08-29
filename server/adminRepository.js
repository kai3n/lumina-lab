import { ApiError } from "./customerRepository.js";
import { query, withTransaction } from "./db.js";
import { supplierOperationalState } from "./supplierWorkflowContract.js";

const CATEGORY_PREFIX = {
  ring: "RING",
  earrings: "EAR",
  bracelet: "BR",
  bangle: "BR",
  necklace: "NECK",
};

function styleView(row) {
  // payload = 클라이언트 스토어 스타일 객체 원본(무손실). 인덱스 컬럼이 진실인
  // 필드(id/published/category)만 payload 위에 덮어쓴다.
  if (row.payload && Object.keys(row.payload).length > 0) {
    return {
      ...row.payload,
      id: row.style_code,
      category: row.category,
      published: row.published,
      sortOrder: row.sort_order,
      updatedAt: row.updated_at,
    };
  }
  // 레거시 행(0008 이전) 폴백 — 마이그레이션이 지우므로 실전에선 도달하지 않는다
  return {
    styleCode: row.style_code,
    category: row.category,
    name: row.name || {},
    summary: row.summary || {},
    heroMedia: row.hero_media || {},
    media: row.media || [],
    supportedMetals: row.supported_metals || [],
    stoneRange: row.stone_range,
    leadTimeDays: {
      min: row.lead_time_min_days,
      max: row.lead_time_max_days,
    },
    published: row.published,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function orderView(row) {
  return {
    orderCode: row.order_code,
    stage: row.stage,
    phase: row.phase,
    waitingOn: row.waiting_on,
    expectedCompletionAt: row.expected_completion_at,
    summary: row.summary || {},
    // 평면 별칭 — 목록 테이블 소비자용 (nested customer와 중복 유지)
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    locale: row.customer_locale,
    customer: {
      customerCode: row.customer_code,
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
      locale: row.customer_locale,
    },
    intake: {
      intakeCode: row.intake_code,
      category: row.intake_category,
      styleCode: row.style_code,
      budgetMinorUnits: row.budget_minor_units,
      currency: row.currency,
      requiredDate: row.required_date,
      referenceMedia: row.reference_media || [],
      formPayload: row.form_payload || {},
    },
    // 최신 제안 총액을 목록의 평면 필드로 노출 — 라이브 파이프라인/완료 매출 집계가 소비한다.
    totalUsd: row.total_usd === null || row.total_usd === undefined ? null : Number(row.total_usd),
    supplierJob: row.supplier_job_code ? {
      jobCode: row.supplier_job_code,
      workflowState: row.supplier_workflow_state,
      ...supplierOperationalState(row.supplier_workflow_state),
      status: row.supplier_assignment_status,
      dueAt: row.supplier_due_at,
      supplierCode: row.supplier_code,
      supplierName: row.supplier_name,
      pendingReviewCount: Number(row.supplier_pending_review_count || 0),
      lastSubmittedAt: row.supplier_last_submitted_at || null,
      lastUpdateType: row.supplier_last_update_type || null,
    } : null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

async function nextStyleCode(client, category) {
  const prefix = CATEGORY_PREFIX[category] || "STYLE";
  const { rows } = await client.query("select nextval('admin_style_code_seq') as value");
  return `${prefix}-CUSTOM-${String(rows[0].value).padStart(4, "0")}`;
}

export async function listAdminStyles() {
  const { rows } = await query(
    `
      select *
      from starter_designs
      order by sort_order asc, updated_at desc, style_code asc
    `,
  );
  return rows.map(styleView);
}

export async function upsertAdminStyle(styleCode, payload = {}) {
  return withTransaction(async (client) => {
    // payload = 클라이언트 스타일 객체 전체. 인덱스 컬럼만 뽑아 별도 저장.
    const category = payload.category || "ring";
    if (!CATEGORY_PREFIX[category]) throw new ApiError("INVALID_STYLE_CATEGORY", 400);
    const code = styleCode || payload.id || await nextStyleCode(client, category);
    const media = Array.isArray(payload.media) ? payload.media : [];
    const style = { ...payload, id: code };
    const { rows } = await client.query(
      `
        insert into starter_designs (
          style_code, category, name, media, published, sort_order, payload
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (style_code) do update set
          category = excluded.category,
          name = excluded.name,
          media = excluded.media,
          published = excluded.published,
          sort_order = excluded.sort_order,
          payload = excluded.payload,
          updated_at = now()
        returning *
      `,
      [
        code,
        category,
        JSON.stringify(payload.name || {}),
        JSON.stringify(media),
        Boolean(payload.published),
        Number(payload.sortOrder ?? 100),
        JSON.stringify(style),
      ],
    );
    await client.query(
      `
        insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
        values ('admin', 'api', 'starter_design', $1, 'upsert', $2)
      `,
      [code, rows[0]],
    );
    return styleView(rows[0]);
  });
}

export async function deleteAdminStyle(styleCode) {
  const { rows } = await query("delete from starter_designs where style_code = $1 returning *", [styleCode]);
  if (!rows[0]) throw new ApiError("STYLE_NOT_FOUND", 404);
  return { deleted: true, styleCode };
}

export async function listAdminOrders() {
  const { rows } = await query(
    `
      select
        o.*,
        c.customer_code,
        c.name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone,
        c.locale as customer_locale,
        i.intake_code,
        i.category as intake_category,
        i.style_code,
        i.budget_minor_units,
        i.currency,
        i.required_date,
        i.reference_media,
        i.form_payload,
        q.total_usd,
        a.supplier_job_code,
        a.supplier_workflow_state,
        a.supplier_assignment_status,
        a.supplier_due_at,
        a.supplier_code,
        a.supplier_name,
        a.supplier_pending_review_count,
        a.supplier_last_submitted_at,
        a.supplier_last_update_type
      from customer_orders o
      join customers c on c.id = o.customer_id
      join customer_intakes i on i.id = o.intake_id
      left join lateral (
        select case
          when pa.payload->>'totalUsd' ~ '^[0-9]+([.][0-9]+)?$' then (pa.payload->>'totalUsd')::numeric
          else null
        end as total_usd
        from published_artifacts pa
        where pa.order_id = o.id and pa.type = 'QUOTE'
        order by pa.published_at desc, pa.id desc
        limit 1
      ) q on true
      left join lateral (
        select sa.job_code as supplier_job_code,
               sa.workflow_state as supplier_workflow_state,
               sa.status as supplier_assignment_status,
               sa.due_at as supplier_due_at,
               s.supplier_code,
               s.display_name as supplier_name,
               (select count(*)::int from supplier_updates su
                where su.supplier_id=sa.supplier_id and su.order_id=sa.order_id
                  and su.review_status='submitted') as supplier_pending_review_count,
               (select max(su.created_at) from supplier_updates su
                where su.supplier_id=sa.supplier_id and su.order_id=sa.order_id) as supplier_last_submitted_at,
               (select su.update_type from supplier_updates su
                where su.supplier_id=sa.supplier_id and su.order_id=sa.order_id
                order by su.created_at desc limit 1) as supplier_last_update_type
        from supplier_order_assignments sa
        join suppliers s on s.id=sa.supplier_id
        where sa.order_id=o.id and sa.status in ('active','completed')
        order by case when sa.status='active' then 0 else 1 end, sa.assigned_at desc
        limit 1
      ) a on true
      order by o.updated_at desc
    `,
  );
  return rows.map(orderView);
}

export async function getAdminOrder(orderCode) {
  const { rows } = await query(
    `
      select
        o.*,
        c.customer_code,
        c.name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone,
        c.locale as customer_locale,
        i.intake_code,
        i.category as intake_category,
        i.style_code,
        i.budget_minor_units,
        i.currency,
        i.required_date,
        i.reference_media,
        i.form_payload,
        q.total_usd,
        a.supplier_job_code,
        a.supplier_workflow_state,
        a.supplier_assignment_status,
        a.supplier_due_at,
        a.supplier_code,
        a.supplier_name,
        a.supplier_pending_review_count,
        a.supplier_last_submitted_at,
        a.supplier_last_update_type
      from customer_orders o
      join customers c on c.id = o.customer_id
      join customer_intakes i on i.id = o.intake_id
      left join lateral (
        select case
          when pa.payload->>'totalUsd' ~ '^[0-9]+([.][0-9]+)?$' then (pa.payload->>'totalUsd')::numeric
          else null
        end as total_usd
        from published_artifacts pa
        where pa.order_id = o.id and pa.type = 'QUOTE'
        order by pa.published_at desc, pa.id desc
        limit 1
      ) q on true
      left join lateral (
        select sa.job_code as supplier_job_code,
               sa.workflow_state as supplier_workflow_state,
               sa.status as supplier_assignment_status,
               sa.due_at as supplier_due_at,
               s.supplier_code,
               s.display_name as supplier_name,
               (select count(*)::int from supplier_updates su
                where su.supplier_id=sa.supplier_id and su.order_id=sa.order_id
                  and su.review_status='submitted') as supplier_pending_review_count,
               (select max(su.created_at) from supplier_updates su
                where su.supplier_id=sa.supplier_id and su.order_id=sa.order_id) as supplier_last_submitted_at,
               (select su.update_type from supplier_updates su
                where su.supplier_id=sa.supplier_id and su.order_id=sa.order_id
                order by su.created_at desc limit 1) as supplier_last_update_type
        from supplier_order_assignments sa
        join suppliers s on s.id=sa.supplier_id
        where sa.order_id=o.id and sa.status in ('active','completed')
        order by case when sa.status='active' then 0 else 1 end, sa.assigned_at desc
        limit 1
      ) a on true
      where o.order_code = $1
    `,
    [orderCode],
  );
  if (!rows[0]) throw new ApiError("ORDER_NOT_FOUND", 404);
  return orderView(rows[0]);
}

export async function updateAdminOrder(orderCode, payload = {}) {
  if (payload.stage || payload.phase || payload.waitingOn) {
    throw new ApiError("ORDER_TRANSITION_REQUIRES_EVENT", 409, "order state can only change through a validated event");
  }
  const updates = [];
  const params = [orderCode];
  const add = (sql, value) => {
    params.push(value);
    updates.push(`${sql} = $${params.length}`);
  };
  if (payload.expectedCompletionAt !== undefined) add("expected_completion_at", payload.expectedCompletionAt || null);
  if (payload.summary) add("summary", JSON.stringify(payload.summary));
  if (updates.length === 0) return getAdminOrder(orderCode);
  const { rows } = await query(
    `
      update customer_orders
      set ${updates.join(", ")}, updated_at = now()
      where order_code = $1
      returning order_code
    `,
    params,
  );
  if (!rows[0]) throw new ApiError("ORDER_NOT_FOUND", 404);
  return getAdminOrder(orderCode);
}

export async function deleteAdminOrder(orderCode) {
  const { rows } = await query("delete from customer_orders where order_code = $1 returning order_code", [orderCode]);
  if (!rows[0]) throw new ApiError("ORDER_NOT_FOUND", 404);
  return { deleted: true, orderCode };
}

export async function createAdminUploadSession(payload = {}) {
  const { rows } = await query("select nextval('media_code_seq') as value");
  const mediaCode = `MED-${String(rows[0].value).padStart(6, "0")}`;
  const storageKey = `admin/${mediaCode}`;
  await query(
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
    uploadUrl: `/v1/admin/media/${mediaCode}/mock-upload`,
    method: "PUT",
    expiresInSeconds: 900,
  };
}
