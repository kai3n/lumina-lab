import { randomBytes } from "node:crypto";
import { ApiError } from "./errors.js";
import { query, withTransaction } from "./db.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { hashToken, issueSession, revokeAllForPrincipal } from "./session.js";
import { createReadUrl, createUploadUrl, inspectStoredMedia } from "./media.js";
import {
  supplierOperationalState,
  syncCustomerOrderToSupplierWorkflow,
} from "./supplierWorkflowContract.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;
const MAX_PASSWORD_RESETS_PER_WINDOW = 5;
const SUPPLIER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPDATE_TYPES = new Set(["ACKNOWLEDGE", "NOTE", "STONE", "ESTIMATE", "CAD", "PROGRESS", "QC", "SHIPPING", "HANDOFF_READY"]);
const VERSIONED_UPDATE_TYPES = new Set(["STONE", "ESTIMATE", "CAD", "PROGRESS", "QC", "SHIPPING"]);
const REVIEWED_UPDATE_TYPES = new Set(["STONE", "ESTIMATE", "CAD", "PROGRESS", "QC"]);
const REVIEW_STATUSES = new Set(["approved", "changes_requested"]);
const VENDOR_WORKFLOW_TRANSITIONS = {
  CONFIRM_PRODUCTION: { from: ["DESIGN_APPROVED"], to: "IN_PRODUCTION" },
};
const SUBMISSION_WORKFLOW = {
  STONE: { from: ["CANDIDATES_REQUIRED", "CANDIDATES_CHANGES"], to: "CANDIDATES_REVIEW" },
  ESTIMATE: { from: ["ESTIMATE_REQUIRED", "ESTIMATE_CHANGES"], to: "ESTIMATE_REVIEW" },
  CAD: { from: ["DESIGN_REQUIRED", "DESIGN_CHANGES"], to: "DESIGN_REVIEW" },
  PROGRESS: { from: ["IN_PRODUCTION", "PROGRESS_CHANGES"], to: "PROGRESS_REVIEW" },
  QC: { from: ["QC_REQUIRED", "QC_CHANGES"], to: "QC_REVIEW" },
  SHIPPING: { from: ["QC_APPROVED"], to: "HANDOFF_READY" },
};
const ADMIN_WORKFLOW_TRANSITIONS = {
  LOCK_DIAMOND: { from: ["CUSTOMER_STONE_SELECTION"], to: "DIAMOND_LOCKED" },
  OPEN_ESTIMATE: { from: ["DIAMOND_LOCKED"], to: "ESTIMATE_REQUIRED" },
  OPEN_QC: { from: ["IN_PRODUCTION"], to: "QC_REQUIRED" },
  APPROVE: { from: ["CUSTOMER_CAD_REVIEW"], to: "DESIGN_APPROVED" },
  REQUEST_CHANGES: { from: ["CUSTOMER_CAD_REVIEW"], to: "DESIGN_CHANGES" },
  CONFIRM_QC: { from: ["CUSTOMER_QC_REVIEW"], to: "QC_APPROVED" },
  REQUEST_QC_CHANGES: { from: ["CUSTOMER_QC_REVIEW"], to: "QC_CHANGES" },
};

const LOCALES = new Set(["zh", "en", "ko"]);
const SUPPLIER_STATUSES = new Set(["invited", "active", "suspended", "archived"]);
const INVENTORY_AVAILABILITY = new Set(["available", "reserved", "unavailable", "sold"]);
const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));
const SUPPLIER_MEDIA_UPLOADS = {
  STONE: { scope: "proposal", states: ["CANDIDATES_REQUIRED", "CANDIDATES_CHANGES"] },
  ESTIMATE: { scope: "proposal", states: ["ESTIMATE_REQUIRED", "ESTIMATE_CHANGES"] },
  CAD: { scope: "cad", states: ["DESIGN_REQUIRED", "DESIGN_CHANGES"] },
  PROGRESS: { scope: "proposal", states: ["IN_PRODUCTION", "PROGRESS_CHANGES"] },
  QC: { scope: "qc", states: ["QC_REQUIRED", "QC_CHANGES"] },
  SHIPPING: { scope: "qc", states: ["QC_APPROVED"] },
};

function mediaKind(contentType) {
  if (String(contentType).startsWith("image/")) return "image";
  if (String(contentType).startsWith("video/")) return "video";
  return "document";
}

function mediaAssetReference(row) {
  return {
    assetId: row.media_code,
    name: String(row.public_payload?.fileName || "").slice(0, 255),
    type: row.mime_type,
    size: row.byte_size == null ? null : Number(row.byte_size),
    key: row.storage_key,
    provider: row.provider,
    ...(row.public_payload?.localUrl ? { url: row.public_payload.localUrl } : {}),
  };
}

async function nextPublicCode(client, sequence, prefix) {
  const { rows } = await client.query(`select nextval('${sequence}') as value`);
  return `${prefix}-${String(rows[0].value).padStart(6, "0")}`;
}

async function lockMutableSupplierOrder(client, { jobCode = null, supplierId = null, orderId = null } = {}) {
  const params = [];
  const filters = ["a.status='active'"];
  if (jobCode != null) {
    params.push(jobCode);
    filters.push(`a.job_code=$${params.length}`);
  }
  if (supplierId != null) {
    params.push(supplierId);
    filters.push(`a.supplier_id=$${params.length}`);
  }
  if (orderId != null) {
    params.push(orderId);
    filters.push(`a.order_id=$${params.length}`);
  }
  const { rows } = await client.query(`
    select o.id, o.stage, exists (
      select 1 from customer_timeline_events e
      where e.order_id=o.id and e.payload->>'type'='cancel_requested'
    ) as cancellation_pending
    from customer_orders o
    join supplier_order_assignments a on a.order_id=o.id
    where ${filters.join(" and ")}
    for update of o
  `, params);
  const order = rows[0];
  if (!order) return null;
  if (order.cancellation_pending) {
    throw new ApiError("CANCELLATION_PENDING", 409, "the cancellation request must be resolved before advancing supplier work");
  }
  if (order.stage === "CANCELLED") {
    throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409, "cancelled orders cannot advance supplier work");
  }
  return order;
}

function publishedSupplierMedia(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    ...(item.assetId ? { assetId: item.assetId } : {}),
    ...(item.key ? { key: item.key, provider: item.provider || "cos" } : { src: item.url }),
    kind: String(item.type || "").startsWith("video/") ? "video" : "image",
    name: item.name || "",
    type: item.type || "",
    size: item.size ?? null,
  }));
}

async function publishSupplierUpdateToCustomer(client, update, assignment) {
  const config = {
    CAD: {
      artifactType: "CAD",
      actionKind: "CAD_REVIEW",
      actionTitle: "Review your CAD",
      allowedResponses: ["APPROVE", "REQUEST_CHANGES"],
      eventType: "cad_ready",
      stage: "CAD",
      phase: "APPROVE_DESIGN",
      workflowState: "CUSTOMER_CAD_REVIEW",
    },
    QC: {
      artifactType: "QC",
      actionKind: "FINAL_QC_CONFIRMATION",
      actionTitle: "Review your finished piece",
      allowedResponses: ["CONFIRM", "REQUEST_CHANGES"],
      eventType: "qc_ready",
      stage: "FINAL_QC",
      phase: "MAKING",
      workflowState: "CUSTOMER_QC_REVIEW",
    },
  }[update.update_type];
  if (!config) return null;
  if (!Array.isArray(update.media) || update.media.length === 0) {
    throw new ApiError("SUPPLIER_MEDIA_REQUIRED", 409, `${update.update_type} media is required before customer publication`);
  }

  const artifactCode = await nextPublicCode(client, "artifact_code_seq", "ART");
  const actionCode = await nextPublicCode(client, "action_code_seq", "ACT");
  const eventCode = await nextPublicCode(client, "timeline_code_seq", "TL");
  await client.query(`
    insert into published_artifacts
      (artifact_code, order_id, type, version_label, subject_version_id, payload, media)
    values ($1,$2,$3,$4,$5,$6,$7)
  `, [artifactCode, update.order_id, config.artifactType, `V${update.version}`, artifactCode,
    { note: update.note || null, supplierUpdateId: update.id }, JSON.stringify(publishedSupplierMedia(update.media))]);
  await client.query(
    "update customer_actions set status='CANCELLED', updated_at=now() where order_id=$1 and status='OPEN'",
    [update.order_id],
  );
  const action = (await client.query(`
    insert into customer_actions
      (action_code, order_id, kind, title, subject_type, subject_version_id, allowed_responses)
    values ($1,$2,$3,$4,$5,$6,$7) returning id
  `, [actionCode, update.order_id, config.actionKind, config.actionTitle,
    config.artifactType, artifactCode, config.allowedResponses])).rows[0];
  await client.query(`
    insert into customer_timeline_events (event_code, order_id, title, payload)
    values ($1,$2,$3,$4)
  `, [eventCode, update.order_id, config.eventType, { type: config.eventType, data: { version: update.version } }]);
  await client.query(`
    update customer_orders
    set stage=$2, phase=$3, waiting_on='CUSTOMER', next_action_id=$4, updated_at=now()
    where id=$1
  `, [update.order_id, config.stage, config.phase, action.id]);
  return { ...config, artifactCode, actionCode };
}

function supplierMedia(supplierId, value) {
  if (!Array.isArray(value)) return [];
  const ownedPrefix = `vendor/${supplierId}/`;
  return value.slice(0, 12).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError("VALIDATION_ERROR", 400);
    const key = item.key == null ? "" : String(item.key);
    const url = item.url == null ? "" : String(item.url);
    const assetId = item.assetId == null ? "" : String(item.assetId);
    if (assetId && !/^MED-[0-9]{6,}$/.test(assetId)) throw new ApiError("VALIDATION_ERROR", 400, "bad media asset id");
    if (key && (!key.startsWith(ownedPrefix) || key.length > 512)) throw new ApiError("VALIDATION_ERROR", 400, "media key not owned by supplier");
    // Keep https URLs for legacy rows uploaded before object keys were stored.
    if (!assetId && !key && !/^https:\/\/[^\s]+$/.test(url)) throw new ApiError("VALIDATION_ERROR", 400, "media key required");
    return {
      ...(assetId ? { assetId } : {}),
      name: String(item.name || "").slice(0, 255),
      type: String(item.type || "").slice(0, 100),
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : null,
      ...(key ? { key, provider: new Set(["cos", "r2", "local"]).has(item.provider) ? item.provider : "cos" } : {}),
      ...(url ? { url } : {}),
    };
  });
}

async function resolvedSupplierMedia(client, supplierId, orderId, assignmentId, updateType, value) {
  const requested = supplierMedia(supplierId, value);
  return Promise.all(requested.map(async (item) => {
    // Legacy supplier_updates may still contain a URL or raw object key and
    // remain readable through readableSupplierMedia(). New submissions must
    // reference a server-registered upload that was verified for this exact
    // supplier job and purpose.
    if (!item.assetId) {
      throw new ApiError("VALIDATION_ERROR", 400, "verified media asset id required");
    }
    const { rows } = await client.query(`
      select * from media_assets
      where media_code=$1 and owner_supplier_id=$2 and order_id=$3
        and supplier_assignment_id=$4 and status='READY' and verified_at is not null
    `, [item.assetId, supplierId, orderId, assignmentId]);
    const asset = rows[0];
    if (!asset) throw new ApiError("MEDIA_NOT_READY", 409);
    if (asset.purpose !== updateType) throw new ApiError("MEDIA_PURPOSE_MISMATCH", 409);
    return mediaAssetReference(asset);
  }));
}

async function readableSupplierMedia(supplierId, value) {
  return Promise.all(supplierMedia(supplierId, value).map(async (item) => {
    if (!item.key) return item;
    try {
      return { ...item, url: await createReadUrl({ key: item.key, provider: item.provider }) };
    } catch (error) {
      // Local development and legacy configuration still have a usable URL.
      if (item.url && (error?.code === "MEDIA_NOT_CONFIGURED" || error?.code === "VALIDATION_ERROR")) return item;
      // Media playback is secondary to order operations. Missing local cloud
      // configuration must not make the entire Admin order unreadable.
      if (error?.code === "MEDIA_NOT_CONFIGURED") {
        return { ...item, url: null, availability: "unavailable", mediaError: error.code };
      }
      throw error;
    }
  }));
}

function emailOf(value) {
  return String(value || "").trim().toLowerCase();
}

function finiteNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validateStructuredUpdate(type, value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (type === "STONE") {
    const candidateCount = finiteNumber(data.candidateCount, { min: 1, max: 20 });
    const batchValidUntil = String(data.batchValidUntil || "").trim();
    const temporaryHoldUntil = String(data.temporaryHoldUntil || "").trim();
    const igiNumbers = String(data.igiNumbers || "").trim();
    const availabilityConfirmed = data.availabilityConfirmed === true;
    if (!Number.isInteger(candidateCount) || !/^\d{4}-\d{2}-\d{2}$/.test(batchValidUntil) || !igiNumbers || !availabilityConfirmed) {
      throw new ApiError("VALIDATION_ERROR", 400);
    }
    if (igiNumbers.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).length > 20) {
      throw new ApiError("VALIDATION_ERROR", 400);
    }
    if (temporaryHoldUntil && Number.isNaN(Date.parse(temporaryHoldUntil))) throw new ApiError("VALIDATION_ERROR", 400);
    return { candidateCount, batchValidUntil, temporaryHoldUntil, igiNumbers, availabilityConfirmed };
  }
  if (type === "ESTIMATE") {
    const netWeightG = finiteNumber(data.netWeightG, { min: 0.01, max: 10000 });
    const lossPct = finiteNumber(data.lossPct, { min: 0, max: 100 });
    const laborCost = finiteNumber(data.laborCost, { min: 0, max: 100000000 });
    const materialCost = finiteNumber(data.materialCost, { min: 0, max: 100000000 });
    const leadTimeDays = finiteNumber(data.leadTimeDays, { min: 1, max: 3650 });
    const currency = String(data.currency || "").toUpperCase();
    const assumptions = String(data.assumptions || "").trim();
    if (netWeightG === null || lossPct === null || laborCost === null || materialCost === null
      || !Number.isInteger(leadTimeDays) || !new Set(["CNY", "USD"]).has(currency)
      || !assumptions || assumptions.length > 2000) throw new ApiError("VALIDATION_ERROR", 400);
    return { netWeightG, lossPct, laborCost, materialCost, leadTimeDays, currency, assumptions };
  }
  if (type === "SHIPPING") {
    const trackingNumber = String(data.trackingNumber || "").trim();
    if (!trackingNumber || trackingNumber.length > 160) throw new ApiError("VALIDATION_ERROR", 400);
    return { trackingNumber };
  }
  return {};
}

function supplierView(row) {
  return {
    id: row.id,
    supplierCode: row.supplier_code,
    displayName: row.display_name,
    email: row.email,
    contactName: row.contact_name,
    status: row.status,
    locale: row.locale,
    timezone: row.timezone,
    activeOrderCount: Number(row.active_order_count || 0),
    lastLoginAt: row.last_login_at,
    invitedAt: row.invited_at || null,
    inviteExpiresAt: row.invite_expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function vendorOrderView(row) {
  // Never pass the whole customer order summary through: it later accumulates
  // addresses, tracking and payment receipts. Only production-safe fields are
  // copied into the vendor contract.
  const source = row.summary || {};
  const summary = {
    category: source.category ?? null,
    styleCode: source.styleCode ?? null,
    metal: source.metal ?? null,
    heroMedia: source.heroMedia ?? null,
    measurements: source.measurements ?? {},
  };
  return {
    jobCode: row.job_code,
    stage: row.stage,
    phase: row.phase,
    expectedCompletionAt: row.expected_completion_at,
    dueAt: row.vendor_due_at,
    assignedAt: row.assigned_at,
    acceptedAt: row.accepted_at,
    workflowState: row.workflow_state,
    ...supplierOperationalState(row.workflow_state),
    lockedDiamond: row.locked_diamond_ref || null,
    category: row.intake_category,
    productLine: row.product_line,
    styleCode: row.style_code,
    summary,
    referenceMedia: row.reference_media || [],
    requiredDate: row.required_date,
    updatedAt: row.updated_at,
  };
}

function inventoryView(row) {
  return {
    id: row.id,
    supplierSku: row.supplier_sku,
    certificateNo: row.certificate_no,
    shape: row.shape,
    carat: row.carat === null ? null : Number(row.carat),
    color: row.color,
    clarity: row.clarity,
    growthMethod: row.growth_method,
    procurementCostUsd: row.procurement_cost_usd === null ? null : Number(row.procurement_cost_usd),
    availability: row.availability,
    reservedOrderId: row.reserved_order_id,
    media: row.media || [],
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSuppliers() {
  const { rows } = await query(`
    select s.*, coalesce(a.active_order_count, 0) as active_order_count,
      i.created_at as invited_at, i.expires_at as invite_expires_at
    from suppliers s
    left join (
      select supplier_id, count(*)::int as active_order_count
      from supplier_order_assignments where status='active' group by supplier_id
    ) a on a.supplier_id = s.id
    left join lateral (
      select created_at, expires_at from supplier_invites
      where supplier_id=s.id and accepted_at is null and revoked_at is null
      order by created_at desc limit 1
    ) i on true
    order by s.created_at desc
  `);
  return rows.map(supplierView);
}

export async function createSupplier(payload, adminId) {
  const email = emailOf(payload.email);
  const displayName = String(payload.displayName || "").trim();
  const contactName = String(payload.contactName || displayName).trim();
  const locale = LOCALES.has(payload.locale) ? payload.locale : "zh";
  if (!EMAIL_RE.test(email) || !displayName || !contactName) throw new ApiError("VALIDATION_ERROR", 400);
  return withTransaction(async (client) => {
    const seq = await client.query("select nextval('supplier_code_seq') as n");
    const supplierCode = `SUP-${String(seq.rows[0].n).padStart(6, "0")}`;
    const { rows } = await client.query(`
      insert into suppliers (supplier_code, display_name, email, contact_name, locale)
      values ($1,$2,$3,$4,$5) returning *
    `, [supplierCode, displayName, email, contactName, locale]);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
      values ('admin', $1, 'supplier', $2, 'created', $3)
    `, [String(adminId), supplierCode, rows[0]]);
    return supplierView(rows[0]);
  }).catch((error) => {
    if (error?.code === "23505") throw new ApiError("SUPPLIER_EMAIL_EXISTS", 409);
    throw error;
  });
}

export async function createSupplierInvite(supplierCode, adminId) {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const { rows } = await query(
    "select * from suppliers where supplier_code=$1 and status in ('invited','active')",
    [supplierCode],
  );
  const supplier = rows[0];
  if (!supplier) throw new ApiError("SUPPLIER_NOT_FOUND", 404);
  await withTransaction(async (client) => {
    await client.query("update supplier_invites set revoked_at=now() where supplier_id=$1 and accepted_at is null and revoked_at is null", [supplier.id]);
    await client.query(`
      insert into supplier_invites (token_hash, supplier_id, expires_at, created_by_admin_id)
      values ($1,$2,$3,$4)
    `, [hashToken(raw), supplier.id, expiresAt, adminId]);
  });
  return { token: raw, expiresAt, supplier: supplierView(supplier) };
}

export async function acceptSupplierInvite(rawToken, password) {
  if (typeof rawToken !== "string" || typeof password !== "string" || password.length < 8) {
    throw new ApiError("VALIDATION_ERROR", 400);
  }
  const supplier = await withTransaction(async (client) => {
    const { rows } = await client.query(`
      select s.*, i.expires_at, i.accepted_at, i.revoked_at
      from supplier_invites i join suppliers s on s.id=i.supplier_id
      where i.token_hash=$1 for update of i
    `, [hashToken(rawToken)]);
    const row = rows[0];
    if (!row || row.accepted_at || row.revoked_at || new Date(row.expires_at) <= new Date()
      || !new Set(["invited", "active"]).has(row.status)) {
      throw new ApiError("SUPPLIER_INVITE_INVALID", 400);
    }
    await client.query("update supplier_invites set accepted_at=now() where token_hash=$1", [hashToken(rawToken)]);
    const updated = await client.query(`
      update suppliers set password_hash=$1, status='active', updated_at=now()
      where id=$2 returning *
    `, [hashPassword(password), row.id]);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
      values ('supplier', $1, 'supplier', $1, 'invite_accepted', $2)
    `, [row.supplier_code, supplierView(updated.rows[0])]);
    return updated.rows[0];
  });
  return { supplier: supplierView(supplier), session: await issueSession("supplier", supplier.id, SUPPLIER_SESSION_TTL_MS) };
}

export async function createSupplierPasswordReset(email) {
  const normalized = emailOf(email);
  if (!EMAIL_RE.test(normalized)) return null;

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "select * from suppliers where email=$1 and status='active' for update",
      [normalized],
    );
    const supplier = rows[0];
    if (!supplier?.password_hash) return null;

    const recent = await client.query(`
      select count(*)::int as count
      from supplier_password_reset_tokens
      where supplier_id=$1 and created_at > $2
    `, [supplier.id, new Date(Date.now() - PASSWORD_RESET_WINDOW_MS)]);
    if (recent.rows[0].count >= MAX_PASSWORD_RESETS_PER_WINDOW) return null;

    const raw = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await client.query(`
      update supplier_password_reset_tokens set used_at=now()
      where supplier_id=$1 and used_at is null
    `, [supplier.id]);
    await client.query(`
      insert into supplier_password_reset_tokens (token_hash, supplier_id, expires_at)
      values ($1,$2,$3)
    `, [hashToken(raw), supplier.id, expiresAt]);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
      values ('supplier', $1, 'supplier', $1, 'password_reset_requested', $2)
    `, [supplier.supplier_code, { expiresAt }]);
    return { token: raw, expiresAt, supplier: supplierView(supplier) };
  });
}

export async function resetSupplierPassword(rawToken, password) {
  if (typeof rawToken !== "string" || typeof password !== "string" || password.length < 8) {
    throw new ApiError("VALIDATION_ERROR", 400);
  }

  const supplier = await withTransaction(async (client) => {
    const { rows } = await client.query(`
      select s.*, t.expires_at, t.used_at
      from supplier_password_reset_tokens t
      join suppliers s on s.id=t.supplier_id
      where t.token_hash=$1
      for update of t
    `, [hashToken(rawToken)]);
    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at) <= new Date()
      || row.status !== "active" || !row.password_hash) {
      throw new ApiError("SUPPLIER_PASSWORD_RESET_INVALID", 400);
    }

    await client.query(`
      update supplier_password_reset_tokens set used_at=now()
      where supplier_id=$1 and used_at is null
    `, [row.id]);
    const updated = await client.query(`
      update suppliers set password_hash=$1, updated_at=now()
      where id=$2 returning *
    `, [hashPassword(password), row.id]);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
      values ('supplier', $1, 'supplier', $1, 'password_reset_completed', $2)
    `, [row.supplier_code, supplierView(updated.rows[0])]);
    return updated.rows[0];
  });

  return {
    supplier: supplierView(supplier),
    session: await issueSession("supplier", supplier.id, SUPPLIER_SESSION_TTL_MS),
  };
}

export async function loginSupplier(email, password) {
  const normalized = emailOf(email);
  const { rows } = await query("select * from suppliers where email=$1 and status='active'", [normalized]);
  const supplier = rows[0];
  const valid = verifyPassword(password, supplier?.password_hash || DUMMY_HASH);
  if (!supplier?.password_hash || !valid) {
    throw new ApiError("INVALID_CREDENTIALS", 401);
  }
  await query("update suppliers set last_login_at=now(), updated_at=now() where id=$1", [supplier.id]);
  return { supplier: supplierView(supplier), session: await issueSession("supplier", supplier.id, SUPPLIER_SESSION_TTL_MS) };
}

export async function getSupplierById(id) {
  const { rows } = await query("select * from suppliers where id=$1", [id]);
  return rows[0] ? supplierView(rows[0]) : null;
}

export async function updateSupplierStatus(supplierCode, status, adminId) {
  if (!SUPPLIER_STATUSES.has(status)) throw new ApiError("VALIDATION_ERROR", 400);
  const { rows } = await query(`
    update suppliers set status=$2, updated_at=now()
    where supplier_code=$1 returning *
  `, [supplierCode, status]);
  const supplier = rows[0];
  if (!supplier) throw new ApiError("SUPPLIER_NOT_FOUND", 404);
  if (status !== "active") await revokeAllForPrincipal("supplier", supplier.id);
  await query(`
    insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
    values ('admin', $1, 'supplier', $2, 'status_changed', $3)
  `, [String(adminId), supplierCode, supplierView(supplier)]);
  return supplierView(supplier);
}

async function jobCodeForAssignment(client, supplierId, orderId, orderCode) {
  const existing = (await client.query(
    "select job_code from supplier_order_assignments where supplier_id=$1 and order_id=$2",
    [supplierId, orderId],
  )).rows[0];
  if (existing) return existing.job_code;

  const preferred = String(orderCode).replace(/^BD-/, "JOB-");
  const preferredTaken = (await client.query(
    "select 1 from supplier_order_assignments where job_code=$1",
    [preferred],
  )).rows[0];
  if (!preferredTaken) return preferred;

  // Reassignments retain their original code. A different vendor assigned to
  // the same order gets an independent code only when the readable suffix is
  // already occupied by assignment history.
  for (;;) {
    const value = (await client.query("select nextval('supplier_job_code_seq') as value")).rows[0].value;
    const candidate = `JOB-${String(value).padStart(6, "0")}`;
    const taken = (await client.query("select 1 from supplier_order_assignments where job_code=$1", [candidate])).rows[0];
    if (!taken) return candidate;
  }
}

export async function assignSupplierOrder({ supplierCode, orderCode, dueAt }, adminId) {
  return withTransaction(async (client) => {
    const supplier = (await client.query("select * from suppliers where supplier_code=$1 and status='active'", [supplierCode])).rows[0];
    const order = (await client.query(`
      select o.*, exists (
        select 1 from customer_timeline_events e
        where e.order_id=o.id and e.payload->>'type'='cancel_requested'
      ) as cancellation_pending
      from customer_orders o where o.order_code=$1 for update
    `, [orderCode])).rows[0];
    if (!supplier) throw new ApiError("SUPPLIER_NOT_FOUND", 404);
    if (!order) throw new ApiError("ORDER_NOT_FOUND", 404);
    if (order.stage === "CANCELLED" || order.cancellation_pending) {
      throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409, "cancelled or pending-cancellation orders cannot be assigned");
    }
    await client.query(`
      update supplier_order_assignments
      set status='revoked', revoked_at=now()
      where order_id=$1 and status='active'
    `, [order.id]);
    const jobCode = await jobCodeForAssignment(client, supplier.id, order.id, order.order_code);
    const { rows } = await client.query(`
      insert into supplier_order_assignments (supplier_id, order_id, assigned_by_admin_id, due_at, job_code)
      values ($1,$2,$3,$4,$5)
      on conflict (supplier_id, order_id) do update set
        status='active', assigned_by_admin_id=excluded.assigned_by_admin_id,
        assigned_at=now(), due_at=excluded.due_at, revoked_at=null, accepted_at=null,
        workflow_state='ASSIGNED', locked_diamond_ref=null, diamond_locked_at=null,
        customer_quote_accepted_at=null, deposit_confirmed_at=null
      returning *
    `, [supplier.id, order.id, adminId, dueAt || null, jobCode]);
    await syncCustomerOrderToSupplierWorkflow(client, order.id, rows[0].workflow_state);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
      values ('admin', $1, 'supplier_order_assignment', $2, 'assigned', $3)
    `, [String(adminId), orderCode, rows[0]]);
    return { supplier: supplierView(supplier), jobCode: rows[0].job_code, dueAt: rows[0].due_at };
  });
}

export async function createSupplierMediaUpload(supplierId, jobCode, payload = {}, options = {}) {
  const purpose = String(payload.purpose || "").toUpperCase();
  const upload = SUPPLIER_MEDIA_UPLOADS[purpose];
  const contentType = String(payload.contentType || "").toLowerCase();
  const fileName = String(payload.fileName || "").trim().slice(0, 255);
  if (!upload || !contentType || !fileName) throw new ApiError("VALIDATION_ERROR", 400);
  return withTransaction(async (client) => {
    const order = await lockMutableSupplierOrder(client, { supplierId, jobCode });
    if (!order) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    const assignment = (await client.query(`
      select a.id, a.order_id, a.workflow_state
      from supplier_order_assignments a
      where a.supplier_id=$1 and a.job_code=$2 and a.status='active'
      for update
    `, [supplierId, jobCode])).rows[0];
    if (!assignment) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    if (!upload.states.includes(assignment.workflow_state)) {
      throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409);
    }
    const signed = await createUploadUrl({
      scope: upload.scope,
      contentType,
      size: payload.size,
      origin: options.origin,
      keyPrefix: `vendor/${supplierId}/${String(jobCode).toLowerCase()}`,
      provider: options.provider,
      videoMaxBytes: options.videoMaxBytes,
      expiresIn: options.expiresIn,
    });
    const mediaCode = `MED-${String((await client.query("select nextval('media_code_seq') as n")).rows[0].n).padStart(6, "0")}`;
    await client.query(`
      insert into media_assets
        (media_code, owner_supplier_id, order_id, supplier_assignment_id, status,
         kind, mime_type, byte_size, storage_key, provider, purpose, public_payload)
      values ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10,$11)
    `, [mediaCode, supplierId, assignment.order_id, assignment.id, mediaKind(contentType), contentType,
      Number(payload.size), signed.key, signed.provider, purpose,
      { fileName, ...(signed.provider === "local" ? { localUrl: signed.publicUrl } : {}) }]);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
      values ('supplier', $1, 'media_asset', $2, 'upload_created', $3)
    `, [String(supplierId), mediaCode, { jobCode, purpose, storageKey: signed.key }]);
    return { ...signed, mediaId: mediaCode, purpose };
  });
}

export async function completeSupplierMediaUpload(supplierId, jobCode, mediaCode) {
  const { rows } = await query(`
    select m.*
    from media_assets m
    join supplier_order_assignments a on a.id=m.supplier_assignment_id
    where m.media_code=$1 and m.owner_supplier_id=$2 and a.job_code=$3
      and a.supplier_id=$2 and a.status='active'
  `, [mediaCode, supplierId, jobCode]);
  const asset = rows[0];
  if (!asset) throw new ApiError("MEDIA_NOT_FOUND", 404);
  if (asset.status !== "READY" && asset.status !== "PENDING" && asset.status !== "UPLOADED") {
    throw new ApiError("MEDIA_NOT_READY", 409);
  }
  // Storage inspection may require a remote HEAD and therefore stays outside
  // the DB transaction. The order/assignment is locked and revalidated below
  // before any READY state is committed.
  const inspected = asset.status === "READY"
    ? null
    : await inspectStoredMedia({ key: asset.storage_key, provider: asset.provider });
  const outcome = await withTransaction(async (client) => {
    const order = await lockMutableSupplierOrder(client, { supplierId, jobCode });
    if (!order) throw new ApiError("MEDIA_NOT_FOUND", 404);
    const current = (await client.query(`
      select m.*
      from media_assets m
      join supplier_order_assignments a on a.id=m.supplier_assignment_id
      where m.media_code=$1 and m.owner_supplier_id=$2 and a.job_code=$3
        and a.supplier_id=$2 and a.status='active'
      for update of a, m
    `, [mediaCode, supplierId, jobCode])).rows[0];
    if (!current) throw new ApiError("MEDIA_NOT_FOUND", 404);
    if (current.status === "READY") return { media: mediaAssetReference(current) };
    if (current.status !== "PENDING" && current.status !== "UPLOADED") {
      throw new ApiError("MEDIA_NOT_READY", 409);
    }
    if (!inspected) throw new ApiError("MEDIA_NOT_READY", 409);
    if (inspected.byteSize !== Number(current.byte_size) || inspected.contentType !== current.mime_type) {
      await client.query("update media_assets set status='REJECTED', updated_at=now() where id=$1", [current.id]);
      return { error: new ApiError("MEDIA_UPLOAD_MISMATCH", 409) };
    }
    const updated = (await client.query(`
      update media_assets set status='READY', etag=$2, verified_at=now(), updated_at=now()
      where id=$1 returning *
    `, [current.id, inspected.etag])).rows[0];
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, after_json)
      values ('supplier', $1, 'media_asset', $2, 'upload_verified', $3)
    `, [String(supplierId), mediaCode, { jobCode, purpose: updated.purpose, etag: updated.etag }]);
    return { media: mediaAssetReference(updated) };
  });
  if (outcome.error) throw outcome.error;
  return outcome.media;
}

const ORDER_SELECT = `
  select o.stage, o.phase, o.expected_completion_at, o.summary, o.updated_at,
         a.job_code, a.workflow_state, a.assigned_at, a.accepted_at, a.locked_diamond_ref,
         a.due_at as vendor_due_at,
         i.category as intake_category, i.product_line, i.style_code, i.required_date, i.reference_media
  from supplier_order_assignments a
  join customer_orders o on o.id=a.order_id
  join customer_intakes i on i.id=o.intake_id
  where a.supplier_id=$1 and a.status in ('active','completed')
`;

export async function listSupplierOrders(supplierId) {
  const { rows } = await query(`${ORDER_SELECT} order by o.updated_at desc`, [supplierId]);
  return rows.map(vendorOrderView);
}

export async function getSupplierOrder(supplierId, jobCode) {
  const { rows } = await query(`${ORDER_SELECT} and a.job_code=$2`, [supplierId, jobCode]);
  if (!rows[0]) throw new ApiError("ORDER_ACCESS_DENIED", 403);
  const updates = await query(`
    select id, update_type, note, media, data, version, review_status, review_note,
           reviewed_at, supersedes_update_id, created_at
    from supplier_updates
    where supplier_id=$1 and order_id=(
      select order_id from supplier_order_assignments
      where supplier_id=$1 and job_code=$2 and status in ('active','completed')
    )
    order by created_at desc
  `, [supplierId, jobCode]);
  return { ...vendorOrderView(rows[0]), updates: await Promise.all(updates.rows.map(async (row) => ({
    id: row.id,
    type: row.update_type,
    note: row.note,
    media: await readableSupplierMedia(supplierId, row.media),
    data: row.data || {},
    version: row.version,
    status: row.review_status,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    supersedesUpdateId: row.supersedes_update_id,
    createdAt: row.created_at,
  }))) };
}

export async function getAdminSupplierOrderContext(orderCode) {
  const assignment = (await query(`
    select a.*, s.supplier_code, s.display_name, s.email
    from supplier_order_assignments a
    join suppliers s on s.id=a.supplier_id
    join customer_orders o on o.id=a.order_id
    where o.order_code=$1 and a.status in ('active','completed')
    order by case when a.status='active' then 0 else 1 end, a.assigned_at desc
    limit 1
  `, [orderCode])).rows[0];
  if (!assignment) return null;
  const updates = (await query(`
    select id, update_type, note, media, data, version, review_status, review_note,
           reviewed_at, supersedes_update_id, created_at
    from supplier_updates
    where supplier_id=$1 and order_id=$2
    order by created_at desc
  `, [assignment.supplier_id, assignment.order_id])).rows;
  const hydratedUpdates = await Promise.all(updates.map(async (row) => ({
    id: row.id,
    type: row.update_type,
    note: row.note,
    media: await readableSupplierMedia(assignment.supplier_id, row.media),
    data: row.data || {},
    version: row.version,
    status: row.review_status,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    supersedesUpdateId: row.supersedes_update_id,
    createdAt: row.created_at,
  })));
  return {
    jobCode: assignment.job_code,
    workflowState: assignment.workflow_state,
    ...supplierOperationalState(assignment.workflow_state),
    status: assignment.status,
    dueAt: assignment.due_at,
    assignedAt: assignment.assigned_at,
    acceptedAt: assignment.accepted_at,
    supplier: {
      supplierCode: assignment.supplier_code,
      displayName: assignment.display_name,
      email: assignment.email,
    },
    pendingReviewCount: hydratedUpdates.filter((row) => row.status === "submitted").length,
    lastSubmittedAt: hydratedUpdates[0]?.createdAt || null,
    lastUpdateType: hydratedUpdates[0]?.type || null,
    updates: hydratedUpdates,
  };
}

export async function addSupplierUpdate(supplierId, jobCode, payload = {}) {
  const type = String(payload.type || "NOTE").toUpperCase();
  const note = payload.note == null ? null : String(payload.note).trim();
  const data = validateStructuredUpdate(type, payload.data);
  if (!UPDATE_TYPES.has(type) || (note && note.length > 2000)) throw new ApiError("VALIDATION_ERROR", 400);
  return withTransaction(async (client) => {
    const mutableOrder = await lockMutableSupplierOrder(client, { supplierId, jobCode });
    if (!mutableOrder) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    const access = await client.query(`
      select a.order_id as id, a.id as assignment_id, a.workflow_state
      from supplier_order_assignments a
      where a.job_code=$1 and a.supplier_id=$2 and a.status='active' for update
    `, [jobCode, supplierId]);
    if (!access.rows[0]) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    const orderId = access.rows[0].id;
    const media = await resolvedSupplierMedia(
      client, supplierId, orderId, access.rows[0].assignment_id, type, payload.media,
    );
    if (new Set(["CAD", "QC", "SHIPPING"]).has(type) && media.length === 0) {
      throw new ApiError("SUPPLIER_MEDIA_REQUIRED", 400, `${type} requires at least one verified image or video`);
    }
    const submission = SUBMISSION_WORKFLOW[type];
    let workflowState = access.rows[0].workflow_state;
    if (submission) {
      if (!submission.from.includes(access.rows[0].workflow_state)) throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409);
      await client.query("update supplier_order_assignments set workflow_state=$3 where supplier_id=$1 and order_id=$2", [supplierId, orderId, submission.to]);
      workflowState = submission.to;
    }
    const versioned = VERSIONED_UPDATE_TYPES.has(type);
    const appendOnly = type === "PROGRESS";
    const previous = versioned && !appendOnly ? (await client.query(`
      select * from supplier_updates
      where supplier_id=$1 and order_id=$2 and update_type=$3
      order by version desc, created_at desc limit 1
    `, [supplierId, orderId, type])).rows[0] : null;
    const progressCount = appendOnly ? Number((await client.query(`
      select count(*)::int as count from supplier_updates
      where supplier_id=$1 and order_id=$2 and update_type='PROGRESS'
    `, [supplierId, orderId])).rows[0].count) : 0;
    const version = previous ? Number(previous.version) + 1 : appendOnly ? progressCount + 1 : 1;
    if (previous && previous.review_status !== "superseded") {
      await client.query("update supplier_updates set review_status='superseded' where id=$1", [previous.id]);
    }
    const { rows } = await client.query(`
      insert into supplier_updates
        (supplier_id, order_id, update_type, note, media, data, version, review_status, supersedes_update_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *
    `, [supplierId, orderId, type, note, JSON.stringify(media), JSON.stringify(data), version,
      REVIEWED_UPDATE_TYPES.has(type) ? "submitted" : "approved", previous?.id || null]);
    await syncCustomerOrderToSupplierWorkflow(client, orderId, workflowState);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, before_json, after_json)
      values ('supplier', $1, 'supplier_job', $2, $3, $4, $5)
    `, [String(supplierId), jobCode, type.toLowerCase(), previous || null, rows[0]]);
    return {
      id: rows[0].id,
      type,
      note,
      media,
      data,
      version,
      status: rows[0].review_status,
      supersedesUpdateId: previous?.id || null,
      createdAt: rows[0].created_at,
    };
  });
}

export async function transitionSupplierWorkflow(supplierId, jobCode, action) {
  const normalized = action === "ACKNOWLEDGE" ? "ACCEPT" : String(action || "").toUpperCase();
  return withTransaction(async (client) => {
    const mutableOrder = await lockMutableSupplierOrder(client, { supplierId, jobCode });
    if (!mutableOrder) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    const before = (await client.query(`
      select a.*, i.product_line, o.order_code, o.stage as order_stage,
             c.email as customer_email, c.locale as customer_locale
      from supplier_order_assignments a
      join customer_orders o on o.id=a.order_id
      join customers c on c.id=o.customer_id
      join customer_intakes i on i.id=o.intake_id
      where a.supplier_id=$1 and a.job_code=$2 and a.status='active' for update of a
    `, [supplierId, jobCode])).rows[0];
    if (!before) throw new ApiError("ORDER_ACCESS_DENIED", 403);
    const transition = normalized === "ACCEPT"
      ? { from: ["ASSIGNED"], to: before.product_line === "multi" ? "ESTIMATE_REQUIRED" : "CANDIDATES_REQUIRED" }
      : VENDOR_WORKFLOW_TRANSITIONS[normalized];
    if (!transition) throw new ApiError("VALIDATION_ERROR", 400);
    if (!transition.from.includes(before.workflow_state)) throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409);
    const updated = (await client.query(`
      update supplier_order_assignments set workflow_state=$3,
        accepted_at=case when $4='ACCEPT' then coalesce(accepted_at,now()) else accepted_at end
      where id=$1 and supplier_id=$2 returning *
    `, [before.id, supplierId, transition.to, normalized])).rows[0];
    let notify = null;
    if (normalized === "CONFIRM_PRODUCTION") {
      const eventCode = await nextPublicCode(client, "timeline_code_seq", "TL");
      await client.query(`
        insert into customer_timeline_events (event_code, order_id, title, payload)
        values ($1,$2,'production_started',$3)
      `, [eventCode, before.order_id, { type: "production_started", data: {} }]);
      await client.query("update customer_orders set next_action_id=null where id=$1", [before.order_id]);
      notify = {
        email: before.customer_email,
        locale: before.customer_locale,
        orderCode: before.order_code,
        type: "production_started",
      };
    }
    await syncCustomerOrderToSupplierWorkflow(client, before.order_id, updated.workflow_state);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, before_json, after_json)
      values ('supplier', $1, 'supplier_job', $2, $3, $4, $5)
    `, [String(supplierId), jobCode, normalized.toLowerCase(), before, updated]);
    return { jobCode, workflowState: updated.workflow_state, acceptedAt: updated.accepted_at, notify };
  });
}

export async function reviewSupplierUpdate(updateId, status, reviewNote, adminId) {
  if (!REVIEW_STATUSES.has(status)) throw new ApiError("VALIDATION_ERROR", 400);
  const note = reviewNote == null ? null : String(reviewNote).trim();
  if (note && note.length > 2000) throw new ApiError("VALIDATION_ERROR", 400);
  return withTransaction(async (client) => {
    const before = (await client.query("select * from supplier_updates where id=$1 for update", [updateId])).rows[0];
    if (!before) throw new ApiError("SUPPLIER_UPDATE_NOT_FOUND", 404);
    if (!VERSIONED_UPDATE_TYPES.has(before.update_type) || before.review_status !== "submitted") {
      throw new ApiError("SUPPLIER_UPDATE_NOT_REVIEWABLE", 409);
    }
    const mutableOrder = await lockMutableSupplierOrder(client, {
      supplierId: before.supplier_id,
      orderId: before.order_id,
    });
    if (!mutableOrder) throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409);
    const expectedReviewState = {
      STONE: "CANDIDATES_REVIEW",
      ESTIMATE: "ESTIMATE_REVIEW",
      CAD: "DESIGN_REVIEW",
      PROGRESS: "PROGRESS_REVIEW",
      QC: "QC_REVIEW",
    }[before.update_type];
    const assignment = (await client.query(`
      select a.*, o.order_code, c.email as customer_email, c.locale as customer_locale
      from supplier_order_assignments a
      join customer_orders o on o.id=a.order_id
      join customers c on c.id=o.customer_id
      where a.supplier_id=$1 and a.order_id=$2 and a.status='active'
      for update of a
    `, [before.supplier_id, before.order_id])).rows[0];
    if (!assignment || (expectedReviewState && assignment.workflow_state !== expectedReviewState)) {
      throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409);
    }
    const updated = (await client.query(`
      update supplier_updates set review_status=$2, review_note=$3,
        reviewed_at=now(), reviewed_by_admin_id=$4
      where id=$1 returning *
    `, [updateId, status, note, adminId])).rows[0];
    const publication = status === "approved"
      ? await publishSupplierUpdateToCustomer(client, updated, assignment)
      : null;
    const reviewTransitions = {
      STONE: status === "approved" ? "CUSTOMER_STONE_SELECTION" : "CANDIDATES_CHANGES",
      ESTIMATE: status === "approved" ? "ESTIMATE_APPROVED" : "ESTIMATE_CHANGES",
      CAD: status === "approved" ? publication?.workflowState : "DESIGN_CHANGES",
      PROGRESS: status === "approved" ? "IN_PRODUCTION" : "PROGRESS_CHANGES",
      QC: status === "approved" ? publication?.workflowState : "QC_CHANGES",
    };
    const nextWorkflow = reviewTransitions[updated.update_type];
    if (nextWorkflow) {
      await client.query(`
        update supplier_order_assignments set workflow_state=$3
        where supplier_id=$1 and order_id=$2 and status='active'
      `, [updated.supplier_id, updated.order_id, nextWorkflow]);
    }
    await syncCustomerOrderToSupplierWorkflow(
      client,
      updated.order_id,
      nextWorkflow || assignment.workflow_state,
    );
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, before_json, after_json)
      values ('admin', $1, 'supplier_update', $2, 'reviewed', $3, $4)
    `, [String(adminId), String(updateId), before, updated]);
    return {
      id: updated.id,
      type: updated.update_type,
      version: updated.version,
      status: updated.review_status,
      reviewNote: updated.review_note,
      reviewedAt: updated.reviewed_at,
      workflowState: nextWorkflow || assignment.workflow_state,
      customerActionCode: publication?.actionCode || null,
      notify: publication ? {
        email: assignment.customer_email,
        locale: assignment.customer_locale,
        orderCode: assignment.order_code,
        type: publication.eventType,
      } : null,
    };
  });
}

export async function transitionSupplierJobByAdmin(jobCode, action, payload = {}, adminId) {
  const normalized = String(action || "").toUpperCase();
  const transition = ADMIN_WORKFLOW_TRANSITIONS[normalized];
  if (!transition) throw new ApiError("VALIDATION_ERROR", 400);
  return withTransaction(async (client) => {
    const mutableOrder = await lockMutableSupplierOrder(client, { jobCode });
    if (!mutableOrder) throw new ApiError("SUPPLIER_JOB_NOT_FOUND", 404);
    const before = (await client.query(`
      select * from supplier_order_assignments
      where job_code=$1 and status='active' for update
    `, [jobCode])).rows[0];
    if (!before) throw new ApiError("SUPPLIER_JOB_NOT_FOUND", 404);
    if (!transition.from.includes(before.workflow_state)) throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409);
    const customerDecision = {
      CUSTOMER_CAD_REVIEW: {
        actionKind: "CAD_REVIEW",
        responses: { APPROVE: "APPROVE", REQUEST_CHANGES: "REQUEST_CHANGES" },
        updateType: "CAD",
        defaultChangeNote: "客户要求修改 CAD",
        approvedTitle: "Customer CAD approval recorded",
        changesTitle: "Customer requested CAD changes",
        timelineType: "customer_cad_response_recorded",
        errorPrefix: "CUSTOMER_CAD",
      },
      CUSTOMER_QC_REVIEW: {
        actionKind: "FINAL_QC_CONFIRMATION",
        responses: { CONFIRM_QC: "CONFIRM", REQUEST_QC_CHANGES: "REQUEST_CHANGES" },
        updateType: "QC",
        defaultChangeNote: "客户要求修改终检",
        approvedTitle: "Customer final piece confirmation recorded",
        changesTitle: "Customer requested final QC changes",
        timelineType: "customer_qc_response_recorded",
        errorPrefix: "CUSTOMER_QC",
      },
    }[before.workflow_state];
    const customerDecisionResponse = customerDecision?.responses[normalized] || null;
    const recordsCustomerDecision = Boolean(customerDecisionResponse);
    let customerAction = null;
    let customerResponse = null;
    if (recordsCustomerDecision) {
      customerAction = (await client.query(`
        select ca.*, o.next_action_id
        from customer_actions ca
        join customer_orders o on o.id=ca.order_id
        where ca.order_id=$1 and ca.kind=$2
        order by ca.created_at desc limit 1
        for update of ca, o
      `, [before.order_id, customerDecision.actionKind])).rows[0];
      if (!customerAction || customerAction.status !== "OPEN" || customerAction.next_action_id !== customerAction.id) {
        throw new ApiError(`${customerDecision.errorPrefix}_ACTION_NOT_OPEN`, 409);
      }
      const response = customerDecisionResponse;
      if (!Array.isArray(customerAction.allowed_responses) || !customerAction.allowed_responses.includes(response)) {
        throw new ApiError(`${customerDecision.errorPrefix}_RESPONSE_NOT_ALLOWED`, 409);
      }
      const reviewNote = response === "REQUEST_CHANGES"
        ? (String(payload.reviewNote || "").trim() || customerDecision.defaultChangeNote)
        : "";
      customerResponse = {
        response,
        source: "ADMIN_RECORDED",
        recordedByAdminId: adminId,
        ...(reviewNote ? { message: reviewNote } : {}),
      };
      await client.query(`
        update customer_actions
        set status='RESPONDED', response_payload=$2, responded_at=now(), updated_at=now()
        where id=$1
      `, [customerAction.id, customerResponse]);
    }
    const lockedDiamondRef = normalized === "LOCK_DIAMOND" ? String(payload.lockedDiamondRef || "").trim() : null;
    if (normalized === "LOCK_DIAMOND" && !lockedDiamondRef) throw new ApiError("VALIDATION_ERROR", 400);
    const updated = (await client.query(`
      update supplier_order_assignments set
        workflow_state=$2,
        locked_diamond_ref=case when $3='LOCK_DIAMOND' then $4 else locked_diamond_ref end,
        diamond_locked_at=case when $3='LOCK_DIAMOND' then now() else diamond_locked_at end,
        customer_quote_accepted_at=case when $3='CUSTOMER_ACCEPT_QUOTE' then now() else customer_quote_accepted_at end,
        deposit_confirmed_at=case when $3='CONFIRM_DEPOSIT' then now() else deposit_confirmed_at end
      where id=$1 returning *
    `, [before.id, transition.to, normalized, lockedDiamondRef])).rows[0];
    await syncCustomerOrderToSupplierWorkflow(client, before.order_id, updated.workflow_state);
    if (recordsCustomerDecision) {
      await client.query(
        "update customer_orders set next_action_id=null, updated_at=now() where id=$1",
        [before.order_id],
      );
      await client.query(`
        insert into customer_timeline_events
          (event_code, order_id, title, body, visibility, payload)
        values ($1,$2,$3,$4,'internal',$5)
      `, [
        await nextPublicCode(client, "timeline_code_seq", "TL"),
        before.order_id,
        customerResponse.response === "REQUEST_CHANGES" ? customerDecision.changesTitle : customerDecision.approvedTitle,
        customerResponse?.message || null,
        { type: customerDecision.timelineType, actionCode: customerAction.action_code, response: customerResponse.response },
      ]);
    }
    if (recordsCustomerDecision && customerResponse.response === "REQUEST_CHANGES") {
      await client.query(`
        update supplier_updates set review_status='changes_requested', review_note=$3,
          reviewed_at=now(), reviewed_by_admin_id=$4
        where id=(select id from supplier_updates where supplier_id=$1 and order_id=$2
          and update_type=$5 order by version desc limit 1)
      `, [before.supplier_id, before.order_id, customerResponse?.message || customerDecision.defaultChangeNote, adminId, customerDecision.updateType]);
    }
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, before_json, after_json)
      values ('admin', $1, 'supplier_job', $2, $3, $4, $5)
    `, [String(adminId), jobCode, normalized.toLowerCase(), before, updated]);
    return {
      jobCode,
      workflowState: updated.workflow_state,
      lockedDiamond: updated.locked_diamond_ref,
      customerActionCode: customerAction?.action_code || null,
    };
  });
}

export async function completeSupplierJob(jobCode, adminId) {
  return withTransaction(async (client) => {
    const mutableOrder = await lockMutableSupplierOrder(client, { jobCode });
    if (!mutableOrder) throw new ApiError("SUPPLIER_JOB_NOT_FOUND", 404);
    const before = (await client.query("select * from supplier_order_assignments where job_code=$1 and status='active' for update", [jobCode])).rows[0];
    if (!before) throw new ApiError("SUPPLIER_JOB_NOT_FOUND", 404);
    if (before.workflow_state !== "HANDOFF_READY") throw new ApiError("INVALID_SUPPLIER_WORKFLOW_TRANSITION", 409);
    const updated = (await client.query(`
      update supplier_order_assignments set workflow_state='COMPLETED', status='completed'
      where id=$1 returning *
    `, [before.id])).rows[0];
    await syncCustomerOrderToSupplierWorkflow(client, before.order_id, updated.workflow_state);
    await client.query(`
      insert into audit_log (actor_type, actor_ref, entity_type, entity_ref, action, before_json, after_json)
      values ('admin', $1, 'supplier_job', $2, 'completed', $3, $4)
    `, [String(adminId), jobCode, before, updated]);
    return { jobCode, workflowState: updated.workflow_state };
  });
}

export async function listSupplierInventory(supplierId) {
  const { rows } = await query("select * from supplier_inventory where supplier_id=$1 and archived_at is null order by updated_at desc", [supplierId]);
  return rows.map(inventoryView);
}

export async function saveSupplierInventory(supplierId, payload = {}, inventoryId = null) {
  const sku = String(payload.supplierSku || "").trim();
  if (!sku && !inventoryId) throw new ApiError("VALIDATION_ERROR", 400);
  const id = inventoryId == null ? null : Number(inventoryId);
  if (inventoryId != null && (!Number.isSafeInteger(id) || id <= 0)) throw new ApiError("VALIDATION_ERROR", 400);
  const carat = payload.carat == null || payload.carat === "" ? null : Number(payload.carat);
  const cost = payload.procurementCostUsd == null || payload.procurementCostUsd === "" ? null : Number(payload.procurementCostUsd);
  if ((carat != null && (!Number.isFinite(carat) || carat <= 0))
    || (cost != null && (!Number.isFinite(cost) || cost < 0))) throw new ApiError("VALIDATION_ERROR", 400);
  if (payload.availability != null && !INVENTORY_AVAILABILITY.has(payload.availability)) {
    throw new ApiError("VALIDATION_ERROR", 400);
  }
  if (id) {
    const { rows } = await query(`
      update supplier_inventory set
        certificate_no=coalesce($3,certificate_no), shape=coalesce($4,shape), carat=coalesce($5,carat),
        color=coalesce($6,color), clarity=coalesce($7,clarity), growth_method=coalesce($8,growth_method),
        procurement_cost_usd=coalesce($9,procurement_cost_usd), availability=coalesce($10,availability),
        media=coalesce($11,media), updated_at=now()
      where id=$1 and supplier_id=$2 and archived_at is null returning *
    `, [id, supplierId, payload.certificateNo, payload.shape, carat, payload.color, payload.clarity,
      payload.growthMethod, cost, payload.availability, payload.media ? JSON.stringify(payload.media) : null]);
    if (!rows[0]) throw new ApiError("INVENTORY_NOT_FOUND", 404);
    return inventoryView(rows[0]);
  }
  const result = await query(`
    insert into supplier_inventory
      (supplier_id,supplier_sku,certificate_no,shape,carat,color,clarity,growth_method,procurement_cost_usd,availability,media)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *
  `, [supplierId, sku, payload.certificateNo || null, payload.shape || null, carat,
    payload.color || null, payload.clarity || null, payload.growthMethod || null,
    cost, payload.availability || "available", JSON.stringify(payload.media || [])]).catch((error) => {
    if (error?.code === "23505") throw new ApiError("INVENTORY_SKU_EXISTS", 409);
    throw error;
  });
  return inventoryView(result.rows[0]);
}
