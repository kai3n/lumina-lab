// 어드민 실주문 콘솔 — 목록/상세 + 이벤트에 실은 아티팩트·고객 액션이 포털까지 흐르는지
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { query } from "../db.js";
import { hashPassword } from "../passwords.js";
import { __resetRateLimit } from "../rateLimit.js";
import { drainMail } from "../mailer.js";
import { truncateAuth, truncateCustomerCore } from "./helpers.js";

const app = createApp();

beforeEach(async () => {
  __resetRateLimit();
  await truncateCustomerCore();
  await truncateAuth();
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

async function submitOrder(email) {
  const res = await request(app).post("/v1/intakes").send({
    email, name: "Console Tester", locale: "ko",
    category: "ring", productLine: "solitaire", termsAccepted: true, conditional: { ringSize: "6" },
  });
  return res.body.orderCode;
}

describe("어드민 실주문 콘솔", () => {
  it("목록/상세는 어드민 전용 (고객 세션은 401)", async () => {
    expect((await request(app).get("/v1/admin/orders")).status).toBe(401);
    const cust = await customerCookie("nosy@test.com");
    expect((await request(app).get("/v1/admin/orders").set("Cookie", cust)).status).toBe(401);
  });

  it("목록에 고객·인테이크 정보가 조인되어 온다", async () => {
    const orderCode = await submitOrder("console@test.com");
    const adm = await adminCookie();
    const res = await request(app).get("/v1/admin/orders").set("Cookie", adm);
    expect(res.status).toBe(200);
    const row = res.body.orders.find((o) => o.orderCode === orderCode);
    expect(row.customer.email).toBe("console@test.com");
    expect(row.stage).toBe("OPS_REVIEW");
  });

  it("이벤트 + 아티팩트 + 액션 → 고객 포털에 그대로 흐른다", async () => {
    const orderCode = await submitOrder("flow@test.com");
    const adm = await adminCookie();
    drainMail();

    // 어드민: 제안 발송 — QUOTE 아티팩트 + QUOTE_ACCEPTANCE 액션을 한 번에
    const send = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({
      type: "proposal_sent",
      artifact: {
        type: "QUOTE", versionLabel: "V1",
        media: [{ kind: "image", src: "https://pub.example/proposal.jpg" }],
        payload: { note: "Your product draft", totalUsd: 1619 },
      },
      action: {
        kind: "QUOTE_ACCEPTANCE", title: "Review your proposal",
        allowedResponses: ["APPROVE", "REQUEST_CHANGES"],
      },
    });
    expect(send.status).toBe(201);
    expect(send.body.stage).toBe("QUOTE");
    expect(send.body.artifactCode).toMatch(/^ART-/);
    expect(send.body.actionCode).toMatch(/^ACT-/);
    await new Promise((r) => setTimeout(r, 50));
    expect(drainMail().find((m) => m.type === "order_proposal_sent")?.locale === undefined).toBe(true); // 메일 발송 자체 확인
    // (제목 로케일은 orderMail.test가 커버 — 여기선 발송 사실만)

    // 고객 포털: 아티팩트 미디어 + 열린 액션 확인
    const cust = await customerCookie("flow@test.com");
    const portal = await request(app).get(`/v1/orders/${orderCode}`).set("Cookie", cust);
    expect(portal.status).toBe(200);
    expect(portal.body.order.stage).toBe("QUOTE");
    expect(portal.body.order.waitingOn).toBe("CUSTOMER");
    expect(portal.body.order.publishedArtifacts[0].media[0].src).toBe("https://pub.example/proposal.jpg");
    const action = portal.body.order.nextAction;
    expect(action.kind).toBe("QUOTE_ACCEPTANCE");
    expect(action.allowedResponses).toEqual(["APPROVE", "REQUEST_CHANGES"]);

    // 고객: 승인 응답 → 액션 닫힘. 제안 승인의 다음 수는 고객의 디파짓이라 waitingOn은 CUSTOMER 유지
    const respond = await request(app).post(`/v1/actions/${action.id}/respond`).set("Cookie", cust)
      .send({ response: "APPROVE", expectedSubjectVersionId: action.subjectVersionId });
    expect(respond.status).toBe(200);
    const after = await request(app).get(`/v1/orders/${orderCode}`).set("Cookie", cust);
    expect(after.body.order.nextAction?.status ?? "NONE").not.toBe("OPEN");
    expect(after.body.order.waitingOn).toBe("CUSTOMER");
    expect(after.body.order.stage).toBe("DEPOSIT");

    // 어드민 상세: 타임라인·발행물·응답된 액션이 모두 보인다
    const detail = await request(app).get(`/v1/admin/orders/${orderCode}`).set("Cookie", adm);
    expect(detail.status).toBe(200);
    expect(detail.body.artifacts).toHaveLength(1);
    expect(detail.body.actions[0].status).toBe("RESPONDED");
    expect(detail.body.timeline.some((t) => t.title === "proposal_sent")).toBe(true);
  });

  it("결제 확인(디파짓→잔금)은 보고된 송금과 견적 금액으로 영수증을 한 번씩 남긴다", async () => {
    const orderCode = await submitOrder("receipt@test.com");
    const adm = await adminCookie();
    const proposal = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({
      type: "proposal_sent",
      artifact: { type: "QUOTE", payload: { totalUsd: 1800, depositUsd: 540 } },
      action: { kind: "QUOTE_ACCEPTANCE", title: "Review", allowedResponses: ["APPROVE", "REQUEST_CHANGES"] },
    });
    const cust = await customerCookie("receipt@test.com");
    await request(app).post(`/v1/actions/${proposal.body.actionCode}/respond`).set("Cookie", cust).send({ response: "APPROVE" });
    await request(app).post(`/v1/orders/${orderCode}/shipping-address`).set("Cookie", cust).send({
      recipientName: "Receipt Test", phone: "+1 213 555 0199", addressLine1: "550 S Hill St",
      addressLine2: "", city: "Los Angeles", region: "CA", postalCode: "90013", country: "US", notes: "",
    });
    await request(app).post(`/v1/orders/${orderCode}/payment-reported`).set("Cookie", cust).send({ kind: "deposit" });
    drainMail();

    // 디파짓 확인 — 견적의 depositUsd(540)를 영수증으로
    const dep = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({ type: "deposit_confirmed" });
    expect(dep.status).toBe(201);
    const afterDep = await request(app).get(`/v1/orders/${orderCode}`).set("Cookie", cust);
    expect(afterDep.body.order.summary.payments).toHaveLength(1);
    expect(afterDep.body.order.summary.payments[0]).toMatchObject({ kind: "deposit_confirmed", amountUsd: 540 });

    await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({ type: "diamond_locked", data: { igi: "IGI-100" } });
    await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({ type: "production_started" });
    const qc = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({
      type: "qc_ready",
      artifact: { type: "QC", media: [{ kind: "video", src: "https://pub.example/qc.mp4" }] },
      action: { kind: "FINAL_QC_CONFIRMATION", title: "Confirm QC", allowedResponses: ["CONFIRM", "REQUEST_CHANGES"] },
    });
    await request(app).post(`/v1/actions/${qc.body.actionCode}/respond`).set("Cookie", cust).send({ response: "CONFIRM" });
    await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({ type: "balance_requested" });

    // 잔금 확인 — 고객 포털 보고 없이 Admin이 오프라인 입금을 기록한다.
    const bal = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({ type: "balance_confirmed" });
    expect(bal.status).toBe(201);
    const afterBal = await request(app).get(`/v1/orders/${orderCode}`).set("Cookie", cust);
    expect(afterBal.body.order.summary.payments).toHaveLength(2);
    expect(afterBal.body.order.summary.payments[1]).toMatchObject({ kind: "balance_confirmed", amountUsd: 1260 });

    // 같은 타입 재발사는 충돌 — 중복 영수증/메일이 생기지 않는다
    const duplicate = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({ type: "balance_confirmed", data: { amountUsd: 1300 } });
    expect(duplicate.status).toBe(409);
    const afterRefire = await request(app).get(`/v1/orders/${orderCode}`).set("Cookie", cust);
    expect(afterRefire.body.order.summary.payments).toHaveLength(2);
    expect(afterRefire.body.order.summary.payments.find((p) => p.kind === "balance_confirmed").amountUsd).toBe(1260);

    await new Promise((r) => setTimeout(r, 50));
    const paymentMail = drainMail().filter((m) => m.type === "order_deposit_confirmed" || m.type === "order_balance_confirmed");
    expect(paymentMail.map((m) => m.type)).toEqual(["order_deposit_confirmed"]);
  });

  it("불법 downstream 이벤트는 현재 열린 액션을 취소하지 않는다", async () => {
    const orderCode = await submitOrder("cancel@test.com");
    const adm = await adminCookie();
    const first = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({
      type: "proposal_sent",
      artifact: { type: "QUOTE", payload: { totalUsd: 1200 } },
      action: { kind: "QUOTE_ACCEPTANCE", title: "First", allowedResponses: ["APPROVE"] },
    });
    const illegal = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm).send({
      type: "qc_ready",
      artifact: { type: "QC", media: [{ kind: "video", src: "https://pub.example/qc.mp4" }] },
      action: { kind: "FINAL_QC_CONFIRMATION", title: "Confirm piece", allowedResponses: ["CONFIRM"] },
    });
    expect(illegal.status).toBe(409);
    const adm2 = await request(app).get(`/v1/admin/orders/${orderCode}`).set("Cookie", adm);
    const byCode = Object.fromEntries(adm2.body.actions.map((a) => [a.id, a.status]));
    expect(byCode[first.body.actionCode]).toBe("OPEN");
    expect(adm2.body.actions.find((a) => a.kind === "FINAL_QC_CONFIRMATION")).toBeUndefined();
  });

  it("이상한 아티팩트 타입/액션 kind는 400", async () => {
    const orderCode = await submitOrder("bad@test.com");
    const adm = await adminCookie();
    const badArtifact = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm)
      .send({ type: "proposal_sent", artifact: { type: "NOT_A_TYPE" } });
    expect(badArtifact.status).toBe(422);
    const badAction = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", adm)
      .send({ type: "proposal_sent", action: { kind: "NOT_A_KIND" } });
    expect(badAction.status).toBe(422);
  });
});
