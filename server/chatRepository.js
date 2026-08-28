import { randomBytes } from "node:crypto";
import { query, withTransaction } from "./db.js";
import { hashToken } from "./session.js";
import { nextCode } from "./codes.js";
import { ApiError } from "./errors.js";
import { isTrustedPublicMediaUrl } from "./media.js";

// 라이브챗 저장소 — 스레드는 서버 발급 토큰(bd_chat, 해시 저장)이나 고객 세션으로만
// 접근. 채팅 본문은 마스킹하지 않는다: 1:1 비공개 채널이라 스태프가 연락처를 봐야 하고,
// 오프라인 이메일 답장을 위해 방문자가 남긴 이메일도 읽을 수 있어야 한다.

const BODY_MAX = 4000;
const ATTACH_MAX = 4;
const OFFLINE_AFTER_MS = 60 * 1000;            // 고객이 이 시간 이상 안 보면 오프라인 → 이메일
const STAFF_NOTIFY_THROTTLE_MS = 5 * 60 * 1000; // 스레드당 스태프 알림 이메일 스로틀

export function newThreadToken() {
  return randomBytes(32).toString("hex");
}

export function cleanBody(body) {
  return String(body ?? "").trim().slice(0, BODY_MAX);
}

export function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  // 첨부 URL은 우리 public-media 경계에서 발급된 chat 키만 허용한다. R2 URL,
  // same-origin COS read gateway, 개발용 local URL을 함께 검증하면서 외부 추적
  // 픽셀이나 다른 scope의 객체가 상담 화면/이메일에 렌더되는 것을 막는다.
  return list
    .filter((a) => a && typeof a.url === "string" && a.url)
    .filter((a) => isTrustedPublicMediaUrl(a.url, { scope: "chat" }))
    .slice(0, ATTACH_MAX)
    .map((a) => ({
      url: String(a.url).slice(0, 600),
      contentType: String(a.contentType || "").slice(0, 120),
      name: String(a.name || "").slice(0, 200),
    }));
}

export function messageView(row) {
  return {
    id: Number(row.id),
    sender: row.sender,
    body: row.body,
    attachments: row.attachments || [],
    senderAdminId: row.sender_admin_id != null ? Number(row.sender_admin_id) : null,
    createdAt: row.created_at,
  };
}

export function threadView(row) {
  return {
    code: row.thread_code,
    status: row.status,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    visitorEmail: row.visitor_email || null,
    locale: row.visitor_locale,
    lastMessageAt: row.last_message_at,
    staffUnread: row.staff_unread,
    customerUnread: row.customer_unread,
    tags: row.tags || [],
    assignedAdminId: row.assigned_admin_id != null ? Number(row.assigned_admin_id) : null,
    csat: row.csat != null ? Number(row.csat) : null,
    createdAt: row.created_at,
  };
}

// ── 조회 ────────────────────────────────────────────────────────────────
export async function findThreadByToken(token) {
  if (!token) return null;
  const { rows } = await query("select * from chat_threads where token_hash = $1", [hashToken(token)]);
  return rows[0] || null;
}

export async function findThreadByCode(code) {
  if (!code) return null;
  const { rows } = await query("select * from chat_threads where thread_code = $1", [String(code)]);
  return rows[0] || null;
}

// 고객의 가장 최근 스레드 (열린 것 우선)
export async function findCustomerThread(customerId) {
  if (!customerId) return null;
  const { rows } = await query(
    `select * from chat_threads where customer_id = $1
     order by (status = 'open') desc, last_message_at desc limit 1`,
    [customerId],
  );
  return rows[0] || null;
}

export async function listMessages(threadId, sinceId = 0) {
  const { rows } = await query(
    "select * from chat_messages where thread_id = $1 and id > $2 order by id asc",
    [threadId, Number(sinceId) || 0],
  );
  return rows.map(messageView);
}

// ── 생성·추가 ────────────────────────────────────────────────────────────
export async function createVisitorThread({ token, activitySessionId = null, locale = "en", customerId = null, visitorEmail = null }) {
  return withTransaction(async (client) => {
    const code = await nextCode(client, "CHAT");
    const { rows } = await client.query(
      `insert into chat_threads (thread_code, token_hash, activity_session_id, visitor_locale, customer_id, visitor_email)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [code, token ? hashToken(token) : null, activitySessionId, String(locale || "en").slice(0, 5), customerId, visitorEmail],
    );
    return rows[0];
  });
}

// 메시지 추가 + 미확인 카운터/타임스탬프 갱신. sender: 'visitor' | 'staff' | 'system'
export async function appendMessage(threadId, { sender, senderAdminId = null, body = "", attachments = [] }) {
  const cleanedBody = cleanBody(body);
  const atts = sanitizeAttachments(attachments);
  if (!cleanedBody && atts.length === 0) throw new ApiError("VALIDATION_ERROR", 400, "empty message");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `insert into chat_messages (thread_id, sender, sender_admin_id, body, attachments)
       values ($1, $2, $3, $4, $5) returning *`,
      [threadId, sender, senderAdminId, cleanedBody, JSON.stringify(atts)],
    );
    // 방문자 메시지 → staff_unread++, 스태프 메시지 → customer_unread++
    const unreadCol = sender === "visitor" ? "staff_unread" : sender === "staff" ? "customer_unread" : null;
    await client.query(
      `update chat_threads set last_message_at = now()
        ${unreadCol ? `, ${unreadCol} = ${unreadCol} + 1` : ""}
       where id = $1`,
      [threadId],
    );
    return messageView(rows[0]);
  });
}

// ── 읽음 처리 ────────────────────────────────────────────────────────────
export async function markStaffRead(threadId) {
  await query("update chat_threads set staff_unread = 0 where id = $1", [threadId]);
}

export async function markCustomerSeen(threadId) {
  await query(
    "update chat_threads set customer_unread = 0, customer_last_seen_at = now() where id = $1",
    [threadId],
  );
}

// ── 로그인 연결 ──────────────────────────────────────────────────────────
// 로그인 성공 시 익명 bd_chat 스레드를 고객과 연결. 이미 고객 스레드가 있으면 병합하지 않고
// 토큰 스레드에 customer_id만 부여(단순화). 이메일 백필.
export async function linkChatToCustomer(token, customerId, email = null) {
  if (!token || !customerId) return;
  await query(
    `update chat_threads
       set customer_id = $2,
           visitor_email = coalesce(visitor_email, $3)
     where token_hash = $1 and (customer_id is null or customer_id = $2)`,
    [hashToken(token), customerId, email],
  );
}

// ── 알림 판단 ────────────────────────────────────────────────────────────
export function shouldNotifyStaff(threadRow) {
  const last = threadRow.staff_notified_at ? new Date(threadRow.staff_notified_at).getTime() : 0;
  return Date.now() - last > STAFF_NOTIFY_THROTTLE_MS;
}

export async function markStaffNotified(threadId) {
  await query("update chat_threads set staff_notified_at = now() where id = $1", [threadId]);
}

// 스태프 답장 시 고객이 오프라인이면 이메일 (마지막 조회가 오래됨 & 이메일 알려짐)
export function customerIsOffline(threadRow) {
  const seen = threadRow.customer_last_seen_at ? new Date(threadRow.customer_last_seen_at).getTime() : 0;
  return Date.now() - seen > OFFLINE_AFTER_MS;
}

// ── 상태 ────────────────────────────────────────────────────────────────
export async function setThreadStatus(code, status) {
  if (status !== "open" && status !== "closed") throw new ApiError("VALIDATION_ERROR", 400, "bad status");
  const { rows } = await query(
    "update chat_threads set status = $2 where thread_code = $1 returning *",
    [String(code), status],
  );
  if (!rows[0]) throw new ApiError("NOT_FOUND", 404);
  return threadView(rows[0]);
}

export async function setVisitorEmail(threadId, email) {
  await query("update chat_threads set visitor_email = $2 where id = $1", [threadId, email]);
}

// ── 어드민 인박스 ────────────────────────────────────────────────────────
export async function listInboxThreads({ status = "open", tag = null } = {}) {
  const where = [];
  const params = [];
  if (status !== "all") { params.push(status); where.push(`t.status = $${params.length}`); }
  if (tag) { params.push(String(tag)); where.push(`$${params.length} = any(t.tags)`); }
  const { rows } = await query(
    `select t.*, c.name as customer_name, c.email as customer_email, a.name as assignee_name,
       (select body from chat_messages m where m.thread_id = t.id order by m.id desc limit 1) as last_body,
       (select sender from chat_messages m where m.thread_id = t.id order by m.id desc limit 1) as last_sender
     from chat_threads t
     left join customers c on c.id = t.customer_id
     left join admin_users a on a.id = t.assigned_admin_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by t.staff_unread > 0 desc, t.last_message_at desc
     limit 100`,
    params,
  );
  return rows.map((r) => ({
    ...threadView(r),
    customerName: r.customer_name || null,
    customerEmail: r.customer_email || null,
    assigneeName: r.assignee_name || null,
    preview: (r.last_body || "").slice(0, 120),
    lastSender: r.last_sender || null,
  }));
}

// ── 태그·담당자·통계 ─────────────────────────────────────────────────────
const TAG_MAX = 8;
export async function setThreadTags(code, tags) {
  const clean = Array.isArray(tags)
    ? [...new Set(tags.map((x) => String(x).trim().slice(0, 24)).filter(Boolean))].slice(0, TAG_MAX)
    : [];
  const { rows } = await query(
    "update chat_threads set tags = $2 where thread_code = $1 returning *",
    [String(code), clean],
  );
  if (!rows[0]) throw new ApiError("NOT_FOUND", 404);
  return threadView(rows[0]);
}

// 스레드에 태그 하나 추가(중복·빈값 제거) — 상담예약 자동 태깅 등에 사용
export async function addThreadTag(threadId, tag) {
  await query(
    `update chat_threads set tags =
       (select array(select distinct e from unnest(array_append(tags, $2)) as e where e is not null and e <> ''))
     where id = $1`,
    [threadId, String(tag).slice(0, 24)],
  );
}

// ── 상담 예약 ────────────────────────────────────────────────────────────
export async function listBookedSlots(fromISO, toISO) {
  const { rows } = await query(
    "select slot_start from consultation_bookings where status = 'booked' and slot_start >= $1 and slot_start < $2",
    [fromISO, toISO],
  );
  return rows.map((r) => new Date(r.slot_start).toISOString());
}

// 슬롯 예약 — 파셜 유니크(booked)로 더블부킹 방지. null이면 이미 잡힌 슬롯.
export async function createBooking({ threadId, slotStart, name, contact, note }) {
  const { rows } = await query(
    `insert into consultation_bookings (thread_id, slot_start, name, contact, note)
     values ($1, $2, $3, $4, $5)
     on conflict (slot_start) where status = 'booked' do nothing
     returning id, slot_start`,
    [threadId || null, slotStart, name || null, contact || null, note || null],
  );
  return rows[0] || null;
}

export async function setThreadCsat(threadId, rating) {
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) throw new ApiError("VALIDATION_ERROR", 400, "rating 1-5");
  // 최초 평가만 반영(덮어쓰기 방지) — 재제출은 무시된다
  await query("update chat_threads set csat = $2 where id = $1 and csat is null", [threadId, r]);
}

export async function assignThread(code, adminId) {
  const { rows } = await query(
    "update chat_threads set assigned_admin_id = $2 where thread_code = $1 returning *",
    [String(code), adminId || null],
  );
  if (!rows[0]) throw new ApiError("NOT_FOUND", 404);
  return threadView(rows[0]);
}

export async function chatStats() {
  const [open, today, unread, firstResp, topTags, csat] = await Promise.all([
    query("select count(*)::int n from chat_threads where status = 'open'"),
    query("select count(*)::int n from chat_threads where created_at >= now() - interval '24 hours'"),
    query("select count(*)::int n from chat_threads where staff_unread > 0 and status = 'open'"),
    query(`
      with firsts as (
        select thread_id,
          min(created_at) filter (where sender = 'visitor') as v0,
          min(created_at) filter (where sender = 'staff' and sender_admin_id is not null) as s0
        from chat_messages group by thread_id
      )
      select round(avg(extract(epoch from (s0 - v0)) / 60.0)::numeric, 1) as mins
      from firsts where v0 is not null and s0 is not null and s0 >= v0`),
    query("select unnest(tags) as tag, count(*)::int n from chat_threads group by 1 order by n desc limit 6"),
    query("select round(avg(csat)::numeric, 1) as avg, count(csat)::int n from chat_threads where csat is not null"),
  ]);
  return {
    open: open.rows[0].n,
    today: today.rows[0].n,
    unread: unread.rows[0].n,
    avgFirstResponseMin: firstResp.rows[0].mins != null ? Number(firstResp.rows[0].mins) : null,
    avgCsat: csat.rows[0].avg != null ? Number(csat.rows[0].avg) : null,
    csatCount: csat.rows[0].n,
    topTags: topTags.rows.map((r) => ({ tag: r.tag, count: r.n })),
  };
}

// 스레드 컨텍스트 — 연결된 고객·주문·최근 활동 (스태프 사이드 패널)
export async function threadContext(threadRow) {
  const ctx = { customer: null, orders: [], activity: [] };
  if (threadRow.customer_id) {
    const c = await query("select id, name, email, locale, created_at from customers where id = $1", [threadRow.customer_id]);
    ctx.customer = c.rows[0]
      ? { name: c.rows[0].name, email: c.rows[0].email, locale: c.rows[0].locale, since: c.rows[0].created_at }
      : null;
    const o = await query(
      "select order_code, stage, created_at from customer_orders where customer_id = $1 order by created_at desc limit 10",
      [threadRow.customer_id],
    );
    ctx.orders = o.rows.map((row) => ({ orderCode: row.order_code, stage: row.stage, createdAt: row.created_at }));
  }
  if (threadRow.activity_session_id) {
    const a = await query(
      "select event_type, path, entity_id, created_at from activity_events where session_id = $1 order by id desc limit 12",
      [threadRow.activity_session_id],
    );
    ctx.activity = a.rows.map((row) => ({ type: row.event_type, path: row.path, entityId: row.entity_id, at: row.created_at }));
  }
  return ctx;
}
