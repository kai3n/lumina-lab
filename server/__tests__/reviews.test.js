// 리뷰 루프 — 배송 완료 인증(운송장/소유권) → 제출(pending) → 어드민 게시 → 홈 피드 공개
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { query } from "../db.js";
import { hashPassword } from "../passwords.js";
import { __resetRateLimit } from "../rateLimit.js";
import { drainMail } from "../mailer.js";
import { truncateAuth, truncateCustomerCore } from "./helpers.js";
import {
  recordOrderEvent, respondToAction, updateOrderShippingAddress, reportOrderPayment,
} from "../customerRepository.js";

const app = createApp();

beforeEach(async () => {
  __resetRateLimit();
  await truncateCustomerCore();
  await truncateAuth();
  await query("delete from customer_reviews");
  await query("delete from login_codes");
  drainMail();
});

async function adminCookie() {
  await query("insert into admin_users (email,name,password_hash) values ($1,$2,$3)",
    ["adm@b.com", "Adm", hashPassword("admin12345")]);
  const login = await request(app).post("/v1/auth/password").send({ email: "adm@b.com", password: "admin12345" });
  return login.headers["set-cookie"];
}

async function customerCookie(email) {
  const res = await request(app).post("/v1/auth/code").send({ email });
  const verify = await request(app).post("/v1/auth/code/verify").send({ email, code: res.body.devCode });
  return verify.headers["set-cookie"];
}

async function deliveredOrder(_admin, email, tracking = "1Z 999-123") {
  const res = await request(app).post("/v1/intakes").send({
    email, name: "Review Tester", locale: "en",
    category: "ring", productLine: "solitaire", termsAccepted: true, conditional: { ringSize: "6" },
  });
  const orderCode = res.body.orderCode;
  const proposal = await recordOrderEvent(orderCode, "proposal_sent", {}, {
    artifact: { type: "QUOTE", payload: { totalUsd: 1_000, depositUsd: 300 } },
    action: { kind: "QUOTE_ACCEPTANCE", title: "Review", allowedResponses: ["APPROVE"] },
  });
  await respondToAction(proposal.actionCode, email, { response: "APPROVE" });
  await updateOrderShippingAddress(orderCode, email, {
    recipientName: "Review Tester", phone: "+1 213 555 0199", addressLine1: "550 S Hill St",
    addressLine2: "", city: "Los Angeles", region: "CA", postalCode: "90013", country: "US", notes: "",
  });
  await reportOrderPayment(orderCode, email, "deposit");
  await recordOrderEvent(orderCode, "deposit_confirmed");
  await recordOrderEvent(orderCode, "diamond_locked", { igi: "IGI-REV-1" });
  await recordOrderEvent(orderCode, "production_started");
  const qc = await recordOrderEvent(orderCode, "qc_ready", {}, {
    artifact: { type: "QC", media: [{ kind: "image", src: "https://cdn.example.com/qc.jpg" }] },
    action: { kind: "FINAL_QC_CONFIRMATION", title: "Confirm", allowedResponses: ["CONFIRM"] },
  });
  await respondToAction(qc.actionCode, email, { response: "CONFIRM" });
  await recordOrderEvent(orderCode, "balance_requested");
  await reportOrderPayment(orderCode, email, "balance");
  await recordOrderEvent(orderCode, "balance_confirmed");
  await recordOrderEvent(orderCode, "shipped", { tracking }, {
    artifact: { type: "SHIPMENT", media: [{ kind: "image", src: "https://cdn.example.com/shipping-receipt.jpg" }] },
  });
  await recordOrderEvent(orderCode, "delivered");
  return orderCode;
}

describe("리뷰 인증·제출·게시", () => {
  it("shipped 이벤트의 운송장이 summary에 저장된다", async () => {
    const admin = await adminCookie();
    const orderCode = await deliveredOrder(admin, "track@test.com", "123123");
    const { rows } = await query("select summary from customer_orders where order_code = $1", [orderCode]);
    expect(rows[0].summary.tracking).toBe("123123");
  });

  it("비로그인 인증: 운송장 일치(포맷 관용)만 통과, 미배송·오입력은 404", async () => {
    const admin = await adminCookie();
    const orderCode = await deliveredOrder(admin, "guest@test.com", "1Z 999-123");

    const wrong = await request(app).post("/v1/reviews/verify").send({ orderCode, tracking: "000000" });
    expect(wrong.status).toBe(404);
    expect(wrong.body.error.code).toBe("REVIEW_NOT_ELIGIBLE");

    // 하이픈/공백/대소문자 무시하고 일치
    const ok = await request(app).post("/v1/reviews/verify").send({ orderCode, tracking: "1z999123" });
    expect(ok.status).toBe(200);

    // 미배송 주문은 운송장이 맞아도 불가
    const fresh = await request(app).post("/v1/intakes").send({
      email: "guest@test.com", name: "R", locale: "en",
      category: "ring", productLine: "solitaire", termsAccepted: true, conditional: { ringSize: "6" },
    });
    const notDelivered = await request(app).post("/v1/reviews/verify")
      .send({ orderCode: fresh.body.orderCode, tracking: "1z999123" });
    expect(notDelivered.status).toBe(404);
  });

  it("로그인 고객은 운송장 없이 소유권으로 인증, 남의 주문은 운송장 필요", async () => {
    const admin = await adminCookie();
    const orderCode = await deliveredOrder(admin, "owner@test.com");
    const owner = await customerCookie("owner@test.com");
    const other = await customerCookie("other@test.com");

    expect((await request(app).post("/v1/reviews/verify").set("Cookie", owner).send({ orderCode })).status).toBe(200);
    expect((await request(app).post("/v1/reviews/verify").set("Cookie", other).send({ orderCode })).status).toBe(404);
  });

  it("제출은 pending — 게시 전 공개 피드에 안 보이고, 게시 후 보인다. 주문당 1건.", async () => {
    const admin = await adminCookie();
    const orderCode = await deliveredOrder(admin, "loop@test.com", "123123");

    const invalid = await request(app).post("/v1/reviews").send({
      orderCode, tracking: "123123", rating: 5,
      quote: "She said yes. call me 010-1234-5678", body: "Perfect.",
      media: [{ kind: "image", src: "https://cdn.example.com/a.jpg" }, { kind: "image", src: "data:image/png;base64,xx" }],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    const submit = await request(app).post("/v1/reviews").send({
      orderCode, tracking: "123123", rating: 5,
      quote: "She said yes. call me 010-1234-5678", body: "Perfect.",
      media: [{ kind: "image", src: "https://cdn.example.com/a.jpg" }],
    });
    expect(submit.status).toBe(201);
    expect(submit.body.review.quote).not.toContain("010-1234-5678"); // 연락처 마스킹
    expect(submit.body.review.media).toHaveLength(1);

    expect((await request(app).get("/v1/reviews")).body.reviews).toHaveLength(0);

    // 중복 제출 차단
    const dup = await request(app).post("/v1/reviews").send({ orderCode, tracking: "123123", quote: "again" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("REVIEW_EXISTS");

    // 어드민 게시 → 공개 피드 노출 (orderCode 등 주문 정보는 공개 뷰에 없다)
    const list = await request(app).get("/v1/admin/reviews").set("Cookie", admin);
    expect(list.body.reviews).toHaveLength(1);
    const reviewCode = list.body.reviews[0].id;
    expect(list.body.reviews[0].status).toBe("pending");
    expect(list.body.reviews[0].orderCode).toBe(orderCode);

    const publish = await request(app).patch(`/v1/admin/reviews/${reviewCode}`).set("Cookie", admin)
      .send({ status: "published" });
    expect(publish.status).toBe(200);

    const feed = await request(app).get("/v1/reviews");
    expect(feed.body.reviews).toHaveLength(1);
    expect(feed.body.reviews[0].quote).toContain("She said yes.");
    expect(feed.body.reviews[0].orderCode).toBeUndefined();
  });

  it("어드민 수동 리뷰: 즉시 게시 기본, 삭제 가능. 어드민 라우트는 고객 세션 401.", async () => {
    const admin = await adminCookie();
    const invalid = await request(app).post("/v1/admin/reviews").set("Cookie", admin).send({
      name: "Broken", rating: 5, quote: "Do not silently save",
      media: [{ kind: "image", src: "blob:https://belovediamond.com/not-uploaded" }],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    const created = await request(app).post("/v1/admin/reviews").set("Cookie", admin).send({
      name: "Mina C.", location: "LA", rating: 5, quote: "Obsessed.",
      media: [{ kind: "image", src: "https://belovediamond.com/assets/x.jpg" }],
    });
    expect(created.status).toBe(201);
    expect(created.body.review.status).toBe("published");
    expect((await request(app).get("/v1/reviews")).body.reviews).toHaveLength(1);

    const cust = await customerCookie("nosy@test.com");
    expect((await request(app).get("/v1/admin/reviews").set("Cookie", cust)).status).toBe(401);

    const del = await request(app).delete(`/v1/admin/reviews/${created.body.review.id}`).set("Cookie", admin);
    expect(del.status).toBe(200);
    expect((await request(app).get("/v1/reviews")).body.reviews).toHaveLength(0);
  });

  it("하프스타: 0.5 단위 저장, 어중간한 값은 스냅, 공개 뷰는 숫자 타입", async () => {
    const admin = await adminCookie();
    const half = await request(app).post("/v1/admin/reviews").set("Cookie", admin)
      .send({ name: "H", rating: 4.5, quote: "half star" });
    expect(half.body.review.rating).toBe(4.5);
    const snapped = await request(app).post("/v1/admin/reviews").set("Cookie", admin)
      .send({ name: "S", rating: 4.3, quote: "snapped" });
    expect(snapped.body.review.rating).toBe(4.5);

    const feed = await request(app).get("/v1/reviews");
    expect(feed.body.reviews.map((r) => r.rating)).toEqual([4.5, 4.5]);
  });

  it("공개 피드는 평점 내림차순, 동점은 최신순", async () => {
    const admin = await adminCookie();
    const mk = async (rating, quote) => {
      const res = await request(app).post("/v1/admin/reviews").set("Cookie", admin)
        .send({ name: "A", rating, quote });
      return res.body.review.id;
    };
    const low = await mk(4, "four");
    const mid = await mk(4.5, "four and a half");
    const oldTop = await mk(5, "five old");
    const newTop = await mk(5, "five new");
    await query("update customer_reviews set created_at = $2 where review_code = $1", [low, "2026-01-03"]);
    await query("update customer_reviews set created_at = $2 where review_code = $1", [oldTop, "2026-01-01"]);
    await query("update customer_reviews set created_at = $2 where review_code = $1", [newTop, "2026-01-02"]);

    const feed = await request(app).get("/v1/reviews");
    expect(feed.body.reviews.map((r) => r.id)).toEqual([newTop, oldTop, mid, low]);
  });

  it("기존 private COS 리뷰 URL은 DB를 바꾸지 않고 안정적인 same-origin 읽기 URL로 직렬화한다", async () => {
    Object.assign(process.env, {
      PUBLIC_ORIGIN: "https://belovediamond.com",
      COS_PUBLIC_URL: "https://private-cos.example",
    });
    try {
      const admin = await adminCookie();
      const legacy = "https://private-cos.example/review/2026-08-27/0123456789abcdef01234567.jpg";
      const created = await request(app).post("/v1/admin/reviews").set("Cookie", admin).send({
        name: "Legacy", rating: 5, quote: "Recovered", media: [{ kind: "image", src: legacy }],
      });
      expect(created.status).toBe(201);
      expect(created.body.review.media[0].src).toBe(
        "https://belovediamond.com/v1/media/read/cos/review/2026-08-27/0123456789abcdef01234567.jpg",
      );

      const feed = await request(app).get("/v1/reviews");
      expect(feed.body.reviews[0].media[0].src).toBe(
        "https://belovediamond.com/v1/media/read/cos/review/2026-08-27/0123456789abcdef01234567.jpg",
      );
      const stored = await query("select media from customer_reviews where review_code = $1", [created.body.review.id]);
      expect(stored.rows[0].media[0].src).toBe(legacy);
    } finally {
      delete process.env.PUBLIC_ORIGIN;
      delete process.env.COS_PUBLIC_URL;
    }
  });
});
