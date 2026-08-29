import { describe, it, expect, beforeEach } from "vitest";
import {
  ApiError as RepoApiError,
  createDraftIntake,
  submitIntake,
  recordOrderEvent,
  respondToAction,
  reportOrderPayment,
  updateOrderShippingAddress,
  cancelOrder,
  getCustomerOrder,
  listServerOrders,
} from "../customerRepository.js";
import { listAdminOrders, updateAdminOrder } from "../adminRepository.js";
import { putSettingsValues } from "../settingsRepository.js";
import { ApiError } from "../errors.js";
import { query } from "../db.js";
import { truncateCustomerCore } from "./helpers.js";

const ADDRESS = {
  recipientName: "Jiwon Kim",
  phone: "+1 213 555 0199",
  addressLine1: "550 S Hill St",
  addressLine2: "Suite 1100",
  city: "Los Angeles",
  region: "CA",
  postalCode: "90013",
  country: "US",
  notes: "Front desk",
};

beforeEach(async () => {
  await truncateCustomerCore();
  await query("delete from app_settings where key = 'opsDepositRate'");
});

async function makeOrder(email = "ev@test.com", extra = {}) {
  const draft = await createDraftIntake({ email, locale: "zh", category: "ring", ...extra });
  return submitIntake(draft.intakeId);
}

async function sendProposal(orderCode, totalUsd = 2_000) {
  return recordOrderEvent(orderCode, "proposal_sent", {}, {
    artifact: { type: "QUOTE", payload: { totalUsd } },
    action: {
      kind: "QUOTE_ACCEPTANCE",
      title: "Review proposal",
      allowedResponses: ["APPROVE", "REQUEST_CHANGES"],
    },
  });
}

async function advanceToProduction(orderCode, email, totalUsd = 2_000) {
  const proposal = await sendProposal(orderCode, totalUsd);
  await respondToAction(proposal.actionCode, email, { response: "APPROVE" });
  await updateOrderShippingAddress(orderCode, email, ADDRESS);
  await reportOrderPayment(orderCode, email, "deposit");
  await recordOrderEvent(orderCode, "deposit_confirmed");
  await recordOrderEvent(orderCode, "diamond_locked", { igi: "IGI-123456" });
  await recordOrderEvent(orderCode, "production_started");
  return proposal;
}

describe("customerRepository", () => {
  it("ApiError는 errors.js와 동일 클래스다 (라우트 에러 핸들러 instanceof 계약)", () => {
    expect(RepoApiError).toBe(ApiError);
  });

  it("submitIntake는 created 플래그와 notify(email/locale)를 반환한다", async () => {
    const draft = await createDraftIntake({ email: "ko@test.com", name: "지원", locale: "ko", category: "ring" });
    const first = await submitIntake(draft.intakeId);
    expect(first.created).toBe(true);
    expect(first.notify).toEqual({ email: "ko@test.com", locale: "ko" });
    expect(first.orderCode).toMatch(/^BD-\d{6}$/);
    const again = await submitIntake(draft.intakeId);
    expect(again.created).toBe(false);
    expect(again.orderCode).toBe(first.orderCode);
  });

  it("클라이언트 styleId를 intake.style_code와 주문 summary.styleCode로 보존한다", async () => {
    await query(
      `insert into starter_designs (style_code, category, name, published, payload)
       values ('RING-TEST-STYLE', 'ring', '{"en":"Test"}'::jsonb, true, '{"id":"RING-TEST-STYLE"}'::jsonb)
       on conflict (style_code) do update set published = true`,
    );
    const draft = await createDraftIntake({ email: "style@test.com", category: "ring", styleId: "RING-TEST-STYLE" });
    const stored = (await query("select entry_mode, style_code from customer_intakes where intake_code = $1", [draft.intakeId])).rows[0];
    expect(stored).toEqual({ entry_mode: "design", style_code: "RING-TEST-STYLE" });
    const order = await submitIntake(draft.intakeId);
    const summary = (await query("select summary from customer_orders where order_code = $1", [order.orderCode])).rows[0].summary;
    expect(summary.styleCode).toBe("RING-TEST-STYLE");
  });

  it("서버 카탈로그에 아직 없는 정적 styleCode도 FK 500 없이 접수하고 원 요청을 보존한다", async () => {
    const styleCode = "RING-STATIC-NOT-SEEDED";
    const draft = await createDraftIntake({
      email: "fresh-catalog@test.com",
      category: "ring",
      styleId: styleCode,
      styleCode,
    });
    const stored = (await query(
      "select style_code, entry_mode, form_payload from customer_intakes where intake_code = $1",
      [draft.intakeId],
    )).rows[0];
    expect(stored.style_code).toBeNull();
    expect(stored.entry_mode).toBe("design");
    expect(stored.form_payload).toMatchObject({ styleId: styleCode, styleCode });

    const order = await submitIntake(draft.intakeId);
    const summary = (await query("select summary from customer_orders where order_code = $1", [order.orderCode])).rows[0].summary;
    expect(summary.styleCode).toBe(styleCode);
  });
});

describe("order integrity state machine", () => {
  it("필수 이벤트 데이터는 422, 단계 건너뛰기는 409이며 상태를 변경하지 않는다", async () => {
    const order = await makeOrder();
    await expect(recordOrderEvent(order.orderCode, "proposal_sent", {}, {
      artifact: { type: "QUOTE", payload: {} },
      action: { kind: "QUOTE_ACCEPTANCE", allowedResponses: ["APPROVE"] },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(recordOrderEvent(order.orderCode, "shipped", { tracking: "1Z999" }, {
      artifact: { type: "SHIPMENT", media: [{ kind: "image", src: "https://cdn.example/shipping-receipt.jpg" }] },
    }))
      .rejects.toMatchObject({ code: "INVALID_ORDER_TRANSITION", status: 409 });
    await expect(recordOrderEvent(order.orderCode, "nope", {}))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(updateAdminOrder(order.orderCode, { stage: "DELIVERED" }))
      .rejects.toMatchObject({ code: "ORDER_TRANSITION_REQUIRES_EVENT", status: 409 });
    await expect(recordOrderEvent("BD-999999", "delivered", {}))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const stored = (await query("select stage from customer_orders where order_code = $1", [order.orderCode])).rows[0];
    expect(stored.stage).toBe("OPS_REVIEW");
  });

  it("견적 승인 뒤 주소 없이도 결제를 보고할 수 있고 동시 중복 보고는 한 건만 기록한다", async () => {
    const email = "payment@test.com";
    const order = await makeOrder(email);
    await putSettingsValues({ opsDepositRate: 0.5 });
    const proposal = await sendProposal(order.orderCode, 1_800);
    const quote = await getCustomerOrder(order.orderCode, email);
    expect(quote.publishedArtifacts[0].payload).toMatchObject({ totalUsd: 1800, depositRate: 0.5, depositUsd: 900 });

    await expect(recordOrderEvent(order.orderCode, "deposit_confirmed"))
      .rejects.toMatchObject({ code: "INVALID_ORDER_TRANSITION", status: 409 });
    await respondToAction(proposal.actionCode, email, { response: "APPROVE" });
    await expect(recordOrderEvent(order.orderCode, "deposit_confirmed"))
      .rejects.toMatchObject({ code: "PAYMENT_REPORT_REQUIRED", status: 409 });
    await expect(reportOrderPayment(order.orderCode, email, "wire"))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    const reports = await Promise.allSettled([
      reportOrderPayment(order.orderCode, email, "deposit"),
      reportOrderPayment(order.orderCode, email, "deposit"),
    ]);
    expect(reports.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = reports.find((result) => result.status === "rejected");
    expect(rejected.reason).toMatchObject({ code: "PAYMENT_ALREADY_REPORTED", status: 409 });
    const count = (await query(
      `select count(*)::int as n from customer_timeline_events
       where payload->>'type' = 'payment_reported' and payload #>> '{data,kind}' = 'deposit'`,
    )).rows[0].n;
    expect(count).toBe(1);

    const confirmed = await recordOrderEvent(order.orderCode, "deposit_confirmed");
    expect(confirmed.receipt).toMatchObject({ amountUsd: 900, totalUsd: 1800, remainingUsd: 900 });
    await expect(recordOrderEvent(order.orderCode, "deposit_confirmed"))
      .rejects.toMatchObject({ code: "INVALID_ORDER_TRANSITION", status: 409 });
  });

  it("수정 요청 뒤 제안 재발행은 허용하지만 응답 대기 중 중복 발행은 막는다", async () => {
    const email = "revision@test.com";
    const order = await makeOrder(email);
    const first = await sendProposal(order.orderCode, 1_500);
    await expect(sendProposal(order.orderCode, 1_600))
      .rejects.toMatchObject({ code: "EVENT_ALREADY_RECORDED", status: 409 });
    await expect(respondToAction(first.actionCode, email, { response: "REQUEST_CHANGES" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await respondToAction(first.actionCode, email, { response: "REQUEST_CHANGES", message: "Use yellow gold" });
    const revised = await sendProposal(order.orderCode, 1_600);
    expect(revised.actionCode).not.toBe(first.actionCode);
    const artifacts = await getCustomerOrder(order.orderCode, email);
    expect(artifacts.publishedArtifacts.filter((artifact) => artifact.type === "QUOTE")).toHaveLength(2);
  });

  it("고객 취소는 송금 보고 전만 즉시 처리하고 열린 액션을 정리한다", async () => {
    const directEmail = "cancel-direct@test.com";
    const direct = await makeOrder(directEmail);
    await sendProposal(direct.orderCode, 1_500);
    const cancelled = await cancelOrder(direct.orderCode, directEmail, "Changed plans");
    expect(cancelled.cancelled).toBe(true);
    const directRows = await query(
      `select o.stage, o.next_action_id, a.status
       from customer_orders o left join customer_actions a on a.order_id = o.id
       where o.order_code = $1`,
      [direct.orderCode],
    );
    expect(directRows.rows[0]).toMatchObject({ stage: "CANCELLED", next_action_id: null, status: "CANCELLED" });

    const reportedEmail = "cancel-reported@test.com";
    const reported = await makeOrder(reportedEmail);
    const proposal = await sendProposal(reported.orderCode, 1_800);
    await respondToAction(proposal.actionCode, reportedEmail, { response: "APPROVE" });
    await updateOrderShippingAddress(reported.orderCode, reportedEmail, ADDRESS);
    await reportOrderPayment(reported.orderCode, reportedEmail, "deposit");
    const requested = await cancelOrder(reported.orderCode, reportedEmail, "Wire already sent");
    expect(requested).toMatchObject({ requested: true });
    expect((await getCustomerOrder(reported.orderCode, reportedEmail)).stage).toBe("DEPOSIT");
    const requestCount = (await query(
      `select count(*)::int as n from customer_timeline_events e
       join customer_orders o on o.id = e.order_id
       where o.order_code = $1 and e.payload->>'type' = 'cancel_requested'`,
      [reported.orderCode],
    )).rows[0].n;
    expect(requestCount).toBe(1);
    await cancelOrder(reported.orderCode, reportedEmail, "Retry");
    const afterRetry = (await query(
      `select count(*)::int as n from customer_timeline_events e
       join customer_orders o on o.id = e.order_id
       where o.order_code = $1 and e.payload->>'type' = 'cancel_requested'`,
      [reported.orderCode],
    )).rows[0].n;
    expect(afterRetry).toBe(1);
    await expect(recordOrderEvent(reported.orderCode, "deposit_confirmed"))
      .rejects.toMatchObject({ code: "CANCELLATION_PENDING", status: 409 });
    await expect(recordOrderEvent(reported.orderCode, "order_cancelled"))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(recordOrderEvent(reported.orderCode, "order_cancelled", { refundNote: "No matching transfer; customer notified" }))
      .resolves.toMatchObject({ stage: "CANCELLED" });
  });

  it("부분 입금 뒤 취소는 진행을 동결하고 환불 금액·메모를 구조화해 남긴다", async () => {
    const email = "partial-refund@test.com";
    const order = await makeOrder(email);
    await advanceToProduction(order.orderCode, email, 2_000);
    await cancelOrder(order.orderCode, email, "Please stop production");

    await expect(recordOrderEvent(order.orderCode, "qc_ready", {}, {
      artifact: { type: "QC", media: [{ kind: "image", src: "https://cdn.example/blocked-qc.jpg" }] },
      action: { kind: "FINAL_QC_CONFIRMATION", allowedResponses: ["CONFIRM"] },
    })).rejects.toMatchObject({ code: "CANCELLATION_PENDING", status: 409 });
    await expect(recordOrderEvent(order.orderCode, "order_cancelled"))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    await recordOrderEvent(order.orderCode, "order_cancelled", { refundNote: "Deposit returned by Zelle" });
    const cancelled = await getCustomerOrder(order.orderCode, email);
    expect(cancelled.stage).toBe("CANCELLED");
    expect(cancelled.summary.refunds).toEqual([
      expect.objectContaining({ amountUsd: 1_000, note: "Deposit returned by Zelle" }),
    ]);
    expect(cancelled.timeline.find((item) => item.payload?.type === "order_cancelled")?.payload?.data)
      .toMatchObject({ refundAmountUsd: 1_000, refundNote: "Deposit returned by Zelle" });
  });

  it("CAD 액션은 명시된 승인 응답과 최신 CAD 미디어만 허용한다", async () => {
    const email = "cad-approval@test.com";
    const order = await makeOrder(email);
    const proposal = await sendProposal(order.orderCode, 2_000);
    await respondToAction(proposal.actionCode, email, { response: "APPROVE" });
    await updateOrderShippingAddress(order.orderCode, email, ADDRESS);
    await reportOrderPayment(order.orderCode, email, "deposit");
    await recordOrderEvent(order.orderCode, "deposit_confirmed");
    await recordOrderEvent(order.orderCode, "diamond_locked", { igi: "IGI-CAD-1" });

    const cadArtifact = { type: "CAD", media: [{ kind: "image", src: "https://cdn.example/cad.jpg" }] };
    await expect(recordOrderEvent(order.orderCode, "cad_ready", {}, {
      artifact: cadArtifact,
      action: { kind: "CAD_REVIEW", allowedResponses: [] },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(recordOrderEvent(order.orderCode, "cad_ready", {}, {
      artifact: cadArtifact,
      action: { kind: "CAD_REVIEW", allowedResponses: ["REQUEST_CHANGES"] },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    const cad = await recordOrderEvent(order.orderCode, "cad_ready", {}, {
      artifact: cadArtifact,
      action: { kind: "CAD_REVIEW", allowedResponses: ["APPROVE", "REQUEST_CHANGES"] },
    });
    await expect(respondToAction(cad.actionCode, email, { response: "CONFIRM" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await respondToAction(cad.actionCode, email, { response: "APPROVE" });
    await expect(recordOrderEvent(order.orderCode, "production_started")).resolves.toMatchObject({ stage: "PRODUCTION" });
  });

  it("견적과 영수증 금액은 센트 단위이며 양수인 디파짓과 잔금을 남긴다", async () => {
    const order = await makeOrder("minor-units@test.com");
    await expect(recordOrderEvent(order.orderCode, "proposal_sent", {}, {
      artifact: { type: "QUOTE", payload: { totalUsd: 100, depositUsd: 0.001 } },
      action: { kind: "QUOTE_ACCEPTANCE", allowedResponses: ["APPROVE"] },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    await putSettingsValues({ opsDepositRate: 0.1 });
    await expect(sendProposal(order.orderCode, 0.01))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("QC 확인과 잔금 수령 뒤 사진 없이 운송장만으로 배송 완료할 수 있다", async () => {
    const email = "happy@test.com";
    const order = await makeOrder(email);
    await putSettingsValues({ opsDepositRate: 0.4 });
    await advanceToProduction(order.orderCode, email, 2_500);

    await expect(recordOrderEvent(order.orderCode, "qc_ready", {}, {
      artifact: { type: "QC", media: [] },
      action: { kind: "FINAL_QC_CONFIRMATION", allowedResponses: ["CONFIRM"] },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    const qc = await recordOrderEvent(order.orderCode, "qc_ready", {}, {
      artifact: { type: "QC", media: [{ kind: "video", src: "https://cdn.example/qc.mp4" }] },
      action: { kind: "FINAL_QC_CONFIRMATION", title: "Confirm QC", allowedResponses: ["CONFIRM", "REQUEST_CHANGES"] },
    });
    await expect(recordOrderEvent(order.orderCode, "balance_requested"))
      .rejects.toMatchObject({ code: "ORDER_PREREQUISITE_MISSING", status: 409 });
    await respondToAction(qc.actionCode, email, { response: "CONFIRM" });
    await recordOrderEvent(order.orderCode, "balance_requested");
    const balance = await recordOrderEvent(order.orderCode, "balance_confirmed");
    expect(balance.receipt).toMatchObject({ amountUsd: 1500, totalUsd: 2500, remainingUsd: 0 });

    await expect(recordOrderEvent(order.orderCode, "shipped", {}))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(recordOrderEvent(order.orderCode, "delivered"))
      .rejects.toMatchObject({ code: "INVALID_ORDER_TRANSITION", status: 409 });
    await updateOrderShippingAddress(order.orderCode, email, { ...ADDRESS, addressLine2: "Updated suite" });
    await recordOrderEvent(order.orderCode, "shipped", { tracking: "1Z 999" });
    await expect(updateOrderShippingAddress(order.orderCode, email, ADDRESS))
      .rejects.toMatchObject({ code: "SHIPPING_ADDRESS_LOCKED", status: 409 });
    await recordOrderEvent(order.orderCode, "delivered");

    const complete = await getCustomerOrder(order.orderCode, email);
    expect(complete.stage).toBe("DELIVERED");
    expect(complete.phases.every((phase) => phase.state === "complete")).toBe(true);
    expect(complete.summary.tracking).toBe("1Z 999");
    expect(complete.summary.payments.map((payment) => payment.amountUsd)).toEqual([1000, 1500]);
    const serverList = await listServerOrders();
    expect(serverList.find((item) => item.orderCode === order.orderCode).totalUsd).toBe(2500);
    const adminList = await listAdminOrders();
    expect(adminList.find((item) => item.orderCode === order.orderCode).totalUsd).toBe(2500);
  });

  it("잔금까지 확인된 주문은 환불 기록 없이 취소할 수 없다", async () => {
    const email = "paid-cancel@test.com";
    const order = await makeOrder(email);
    await advanceToProduction(order.orderCode, email, 2_000);
    const qc = await recordOrderEvent(order.orderCode, "qc_ready", {}, {
      artifact: { type: "QC", media: [{ kind: "video", src: "https://cdn.example/paid-qc.mp4" }] },
      action: { kind: "FINAL_QC_CONFIRMATION", allowedResponses: ["CONFIRM"] },
    });
    await respondToAction(qc.actionCode, email, { response: "CONFIRM" });
    await recordOrderEvent(order.orderCode, "balance_requested");
    await reportOrderPayment(order.orderCode, email, "balance");
    await recordOrderEvent(order.orderCode, "balance_confirmed");
    await expect(recordOrderEvent(order.orderCode, "order_cancelled", { refundNote: "manual" }))
      .rejects.toMatchObject({ code: "INVALID_ORDER_TRANSITION", status: 409 });
    expect((await getCustomerOrder(order.orderCode, email)).stage).toBe("BALANCE");
  });

  it("배송지는 필수 필드와 타입을 검증하고 배송 전에는 안전하게 수정할 수 있다", async () => {
    const email = "address@test.com";
    const order = await makeOrder(email);
    await expect(updateOrderShippingAddress(order.orderCode, email, { ...ADDRESS, postalCode: "" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(updateOrderShippingAddress(order.orderCode, email, { ...ADDRESS, phone: { value: "213" } }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    const first = await updateOrderShippingAddress(order.orderCode, email, ADDRESS);
    const second = await updateOrderShippingAddress(order.orderCode, email, { ...ADDRESS, city: "Pasadena" });
    expect(first.shippingAddress.city).toBe("Los Angeles");
    expect(second.shippingAddress.city).toBe("Pasadena");
    const timelineCount = (await query(
      "select count(*)::int as n from customer_timeline_events where payload->>'type' = 'shipping_address_confirmed'",
    )).rows[0].n;
    expect(timelineCount).toBe(1);
  });

  it("디파짓 설정은 10%~90% 범위만 저장한다", async () => {
    await expect(putSettingsValues({ opsDepositRate: 0.09 }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(putSettingsValues({ opsDepositRate: 0.91 }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(putSettingsValues({ opsDepositRate: 0.65 })).resolves.toMatchObject({ opsDepositRate: 0.65 });
  });
});
