import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { createApp } from "../app.js";
import { truncateCustomerCore } from "./helpers.js";
import { drainMail } from "../mailer.js";
import { __resetRateLimit } from "../rateLimit.js";
import { query } from "../db.js";
import { hashPassword } from "../passwords.js";
import { attachPrincipal } from "../middleware.js";
import { customerRouter } from "../customerRoutes.js";

const app = createApp();
const intakeBody = { email: "new@test.com", name: "Jiwon", locale: "ko", category: "ring", termsAccepted: true };

beforeEach(async () => { await truncateCustomerCore(); __resetRateLimit(); drainMail(); });

async function adminAgent() {
  await query("insert into admin_users (email, name, password_hash) values ($1,$2,$3) on conflict (email) do nothing",
    ["ops@test.com", "Ops", hashPassword("admin12345")]);
  const agent = request.agent(app);
  const login = await agent.post("/v1/auth/password").send({ email: "ops@test.com", password: "admin12345" });
  expect(login.status).toBe(200);
  return agent;
}

describe("POST /v1/intakes", () => {
  it("주문 생성 + 로케일 확인 메일 1통", async () => {
    const res = await request(app).post("/v1/intakes").send(intakeBody);
    expect(res.status).toBe(201);
    expect(res.body.orderCode).toMatch(/^BD-\d{6}$/);
    expect(res.body.stage).toBe("OPS_REVIEW");
    const mails = drainMail();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("new@test.com");
    expect(mails[0].type).toBe("order_received");
    expect(mails[0].subject).toContain("접수");
  });

  it("같은 Idempotency-Key 재요청은 같은 주문·메일 1통", async () => {
    const key = "test-key-1";
    const a = await request(app).post("/v1/intakes").set("Idempotency-Key", key).send(intakeBody);
    const b = await request(app).post("/v1/intakes").set("Idempotency-Key", key).send(intakeBody);
    expect(b.status).toBe(201);
    expect(b.body.orderCode).toBe(a.body.orderCode);
    expect(drainMail()).toHaveLength(1);
    const c = await request(app).post("/v1/intakes").set("Idempotency-Key", key).send({ ...intakeBody, name: "다른값" });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("동시 같은-키 요청도 주문 1건·메일 1통 (advisory lock 직렬화)", async () => {
    const key = "race-key-1";
    const [a, b] = await Promise.all([
      request(app).post("/v1/intakes").set("Idempotency-Key", key).send(intakeBody),
      request(app).post("/v1/intakes").set("Idempotency-Key", key).send(intakeBody),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.orderCode).toBe(b.body.orderCode);
    expect(drainMail()).toHaveLength(1);
    const { rows } = await query("select count(*)::int as n from customer_orders");
    expect(rows[0].n).toBe(1);
  });

  it("이메일 없으면 400 VALIDATION_ERROR", async () => {
    const res = await request(app).post("/v1/intakes").send({ name: "NoMail" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  // 왜: intakes(limit 5)와 auth/magic-link(limit 5)가 IP 기본 키를 공유하면 서로의 버킷을 소모한다 —
  // route-scoped 키(intakes:<ip>)로 분리되었는지 회귀 검증. 수정 전에는 6번째 히트(magic-link)가 429였다.
  it("인테이크 버킷 소모는 magic-link 버킷에 영향을 주지 않는다 (라우트별 격리)", async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post("/v1/intakes").send({ ...intakeBody, email: `iso${i}@test.com` });
      expect(res.status).toBe(201);
    }
    const magicLink = await request(app).post("/v1/auth/magic-link").send({ email: "iso@test.com" });
    expect(magicLink.status).not.toBe(429);
  });
});

describe("POST /v1/admin/orders/:orderCode/events", () => {
  it("어드민 세션 없으면 401", async () => {
    const res = await request(app).post("/v1/admin/orders/BD-000001/events").send({ type: "shipped" });
    expect(res.status).toBe(401);
  });

  it("단계 건너뛰기 이벤트는 409이고 상태·메일을 변경하지 않는다", async () => {
    const intake = await request(app).post("/v1/intakes").send(intakeBody);
    drainMail(); // 접수 메일 비우기
    const agent = await adminAgent();
    const res = await agent.post(`/v1/admin/orders/${intake.body.orderCode}/events`)
      .send({
        type: "shipped", data: { tracking: "1Z999" },
        artifact: { type: "SHIPMENT", media: [{ kind: "image", src: "https://cdn.example/shipping-receipt.jpg" }] },
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_ORDER_TRANSITION");
    expect(drainMail()).toHaveLength(0);
    const row = (await query("select stage from customer_orders where order_code = $1", [intake.body.orderCode])).rows[0];
    expect(row.stage).toBe("OPS_REVIEW");
  });

  it("received·미지원 type·프로토타입 속성명은 422 VALIDATION_ERROR", async () => {
    const agent = await adminAgent();
    for (const type of ["received", "bogus", "toString", "__proto__"]) {
      const res = await agent.post("/v1/admin/orders/BD-000001/events").send({ type });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("이벤트 라우트 자체의 requireAdmin — 상류 라우터 없이도 401", async () => {
    const bare = express();
    bare.use(express.json());
    bare.use(cookieParser());
    bare.use(attachPrincipal);
    bare.use("/v1", customerRouter());
    bare.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: { code: err.code || "INTERNAL_ERROR" } }));
    const res = await request(bare).post("/v1/admin/orders/BD-000001/events").send({ type: "shipped" });
    expect(res.status).toBe(401);
  });
});
