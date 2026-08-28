// 고객 리뷰 — 배송 완료 주문만, 주문당 1건. 제출은 pending으로 들어와 어드민 검수 후 홈 노출.
// 인증: 로그인 고객은 주문 소유권, 비로그인은 주문번호+운송장(summary.tracking) 매칭.
import { query, withTransaction } from "./db.js";
import { ApiError } from "./errors.js";
import { nextCode } from "./codes.js";
import { maskContacts } from "../src/lib/masking.js";
import { readableMediaUrl } from "./media.js";

// 운송장 비교는 포맷 관용 — 공백/하이픈/대소문자 차이로 실패하지 않게 영숫자만 남긴다
const normalizeTracking = (s) => String(s || "").replace(/[^0-9a-z]/gi, "").toUpperCase();

// 절대 URL 또는 루트 상대(/assets/.. 셀프호스팅) — base64/blob 프리뷰는 저장하지 않는다
const SRC_OK = /^(https?:\/\/|\/(?!\/))/;

// 별점은 0.5 단위로 스냅, 1~5 클램프 — 잘못된 값은 5
const clampRating = (v) => Math.min(5, Math.max(1, Math.round((Number(v) || 5) * 2) / 2));

function sanitizeMedia(media) {
  if (media == null) return [];
  if (!Array.isArray(media) || media.length > 5) {
    throw new ApiError("VALIDATION_ERROR", 400, "invalid review media");
  }
  return media.map((m) => {
    if (!m || m.transient || typeof m.src !== "string" || !SRC_OK.test(m.src)) {
      throw new ApiError("VALIDATION_ERROR", 400, "review media upload incomplete");
    }
    if (m.poster && (typeof m.poster !== "string" || !SRC_OK.test(m.poster))) {
      throw new ApiError("VALIDATION_ERROR", 400, "review media poster upload incomplete");
    }
    return {
      kind: m.kind === "video" ? "video" : "image",
      src: m.src,
      ...(typeof m.poster === "string" && SRC_OK.test(m.poster) ? { poster: m.poster } : {}),
    };
  });
}

function publicReviewView(row) {
  return {
    id: row.review_code, name: row.name, location: row.location, rating: Number(row.rating),
    quote: row.quote,
    body: row.body,
    media: (row.media || []).map((item) => ({
      ...item,
      src: readableMediaUrl(item?.src),
      ...(item?.poster ? { poster: readableMediaUrl(item.poster) } : {}),
    })),
    createdAt: row.created_at,
  };
}

function adminReviewView(row) {
  return { ...publicReviewView(row), orderCode: row.order_code || "", status: row.status };
}

// 배송 완료 + (소유권 또는 운송장 일치) + 살아있는 리뷰 없음 — 실패는 전부 같은 에러로
// (주문 존재 여부·운송장 일치 여부를 구분해 알려주면 열거 공격에 힌트가 된다)
async function findEligibleOrder(client, { orderCode, tracking, customerId }) {
  const code = String(orderCode || "").trim().toUpperCase();
  if (!code) throw new ApiError("REVIEW_NOT_ELIGIBLE", 404);
  const { rows } = await client.query(
    `select o.id, o.order_code, o.stage, o.summary, o.customer_id, c.name as customer_name
     from customer_orders o join customers c on c.id = o.customer_id
     where o.order_code = $1`,
    [code],
  );
  const order = rows[0];
  if (!order || order.stage !== "DELIVERED") throw new ApiError("REVIEW_NOT_ELIGIBLE", 404);
  const owns = customerId != null && Number(order.customer_id) === Number(customerId);
  if (!owns) {
    const stored = normalizeTracking(order.summary?.tracking);
    const given = normalizeTracking(tracking);
    if (!stored || !given || stored !== given) throw new ApiError("REVIEW_NOT_ELIGIBLE", 404);
  }
  const dup = await client.query(
    "select 1 from customer_reviews where order_id = $1 and status <> 'hidden' limit 1",
    [order.id],
  );
  if (dup.rows[0]) throw new ApiError("REVIEW_EXISTS", 409);
  return order;
}

export async function verifyReviewEligibility(params) {
  return withTransaction(async (client) => {
    await findEligibleOrder(client, params);
    return { ok: true };
  });
}

export async function submitCustomerReview({ orderCode, tracking, customerId, rating, quote, body, media, name, location }) {
  const quoteText = maskContacts(String(quote || "").trim()).slice(0, 200);
  if (!quoteText) throw new ApiError("VALIDATION_ERROR", 400, "quote required");
  const bodyText = maskContacts(String(body || "").trim()).slice(0, 2000);
  return withTransaction(async (client) => {
    const order = await findEligibleOrder(client, { orderCode, tracking, customerId });
    const reviewCode = await nextCode(client, "REV");
    const displayName = maskContacts(String(name || order.customer_name || "Client").trim().slice(0, 80)) || "Client";
    const loc = maskContacts(String(location || "").trim().slice(0, 80));
    const ratingNum = clampRating(rating);
    try {
      const { rows } = await client.query(
        `insert into customer_reviews (review_code, order_id, name, location, rating, quote, body, media, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         returning *`,
        [reviewCode, order.id, displayName, loc, ratingNum, quoteText, bodyText, JSON.stringify(sanitizeMedia(media))],
      );
      return publicReviewView(rows[0]);
    } catch (e) {
      if (e.code === "23505") throw new ApiError("REVIEW_EXISTS", 409); // 동시 제출 레이스
      throw e;
    }
  });
}

export async function listPublishedReviews() {
  // 평점 우선 정렬 — limit에 걸릴 만큼 리뷰가 쌓여도 고평점 리뷰가 먼저 노출된다
  const { rows } = await query(
    "select * from customer_reviews where status = 'published' order by rating desc, created_at desc limit 60",
  );
  return rows.map(publicReviewView);
}

// ── 어드민 큐레이션 — 마스킹 없이 저장(신뢰 입력), 홈 노출 콘텐츠를 직접 관리
export async function listAllReviews() {
  const { rows } = await query(
    `select r.*, o.order_code from customer_reviews r
     left join customer_orders o on o.id = r.order_id
     order by r.created_at desc limit 200`,
  );
  return rows.map(adminReviewView);
}

const ADMIN_STATUSES = new Set(["pending", "published", "hidden"]);

export async function saveAdminReview(payload = {}) {
  const fields = {
    ...(payload.name !== undefined ? { name: String(payload.name).trim().slice(0, 80) } : {}),
    ...(payload.location !== undefined ? { location: String(payload.location).trim().slice(0, 80) } : {}),
    ...(payload.rating !== undefined ? { rating: clampRating(payload.rating) } : {}),
    ...(payload.quote !== undefined ? { quote: String(payload.quote).trim().slice(0, 200) } : {}),
    ...(payload.body !== undefined ? { body: String(payload.body).trim().slice(0, 2000) } : {}),
    ...(payload.media !== undefined ? { media: JSON.stringify(sanitizeMedia(payload.media)) } : {}),
    ...(payload.status !== undefined && ADMIN_STATUSES.has(payload.status) ? { status: payload.status } : {}),
  };
  return withTransaction(async (client) => {
    try {
      if (payload.id) {
        const keys = Object.keys(fields);
        if (keys.length === 0) throw new ApiError("VALIDATION_ERROR", 400, "no fields");
        const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
        const { rows } = await client.query(
          `update customer_reviews set ${sets}, updated_at = now()
           where review_code = $1
           returning *, (select order_code from customer_orders o where o.id = order_id) as order_code`,
          [payload.id, ...keys.map((k) => fields[k])],
        );
        if (!rows[0]) throw new ApiError("NOT_FOUND", 404);
        return adminReviewView(rows[0]);
      }
      // 수동 추가 — 주문번호가 실주문과 일치하면 연결(Verified), 아니면 큐레이션 콘텐츠로 무연결
      let orderId = null;
      if (payload.orderCode) {
        const { rows } = await client.query(
          "select id from customer_orders where order_code = $1",
          [String(payload.orderCode).trim().toUpperCase()],
        );
        orderId = rows[0]?.id || null;
      }
      const reviewCode = await nextCode(client, "REV");
      const { rows } = await client.query(
        `insert into customer_reviews (review_code, order_id, name, location, rating, quote, body, media, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning *, (select order_code from customer_orders o where o.id = order_id) as order_code`,
        [reviewCode, orderId, fields.name || "", fields.location || "", fields.rating || 5,
          fields.quote || "", fields.body || "", fields.media || "[]",
          fields.status || "published"],
      );
      return adminReviewView(rows[0]);
    } catch (e) {
      if (e.code === "23505") throw new ApiError("REVIEW_EXISTS", 409); // 주문당 1건 인덱스
      throw e;
    }
  });
}

export async function deleteReviewByCode(reviewCode) {
  const { rowCount } = await query("delete from customer_reviews where review_code = $1", [reviewCode]);
  if (rowCount === 0) throw new ApiError("NOT_FOUND", 404);
  return { ok: true };
}
