import { describe, expect, it } from "vitest";
import { ApiUnavailableError } from "../../../lib/api.js";
import { adminErrorStatus, adminFlowSteps, adminStepGuard, buildAdminProgressPhases } from "../AdminLiveOrders.jsx";

const t = {
  blockedPrevious: "previous",
  waitQuoteApproval: "quote",
  waitDepositReport: "deposit",
  waitVendorStart: "vendor-start",
  waitQcApproval: "qc",
  waitBalanceReport: "balance",
  addressRequired: "address",
};

const event = (type, data = {}) => ({ title: type, payload: { type, data } });

function guard(step, index, overrides = {}) {
  return adminStepGuard({
    step,
    index,
    order: { summary: {} },
    timeline: [],
    actions: [],
    changeRequest: null,
    t,
    ...overrides,
  });
}

describe("adminStepGuard", () => {
  it("prevents operators from skipping an earlier event", () => {
    expect(guard({ type: "production_started" }, 3)).toEqual({ available: false, reason: "previous" });
  });

  it("requires both proposal approval and a reported deposit before confirming receipt", () => {
    const base = { timeline: [event("proposal_sent")] };
    expect(guard({ type: "deposit_confirmed" }, 1, base).reason).toBe("quote");

    const approved = {
      ...base,
      actions: [{ kind: "QUOTE_ACCEPTANCE", status: "RESPONDED", respondedAt: "2026-07-10", responsePayload: { response: "APPROVE" } }],
    };
    expect(guard({ type: "deposit_confirmed" }, 1, approved).reason).toBe("deposit");

    expect(guard({ type: "deposit_confirmed" }, 1, {
      ...approved,
      timeline: [...base.timeline, event("payment_reported", { kind: "deposit" })],
    })).toEqual({ available: true, reason: "" });
  });

  it("does not let operations start supplier production before the supplier confirms", () => {
    const timeline = ["proposal_sent", "deposit_confirmed", "diamond_locked"].map(event);
    expect(guard({ type: "production_started" }, 3, {
      timeline,
      supplierJob: { workflowState: "DESIGN_APPROVED" },
    })).toEqual({ available: false, reason: "vendor-start" });
    expect(guard({ type: "production_started" }, 3, {
      timeline,
      supplierJob: { workflowState: "IN_PRODUCTION" },
    })).toEqual({ available: true, reason: "" });
  });

  it("requires a confirmed finished piece before requesting the balance", () => {
    const timeline = ["proposal_sent", "deposit_confirmed", "diamond_locked", "production_started", "qc_ready"].map(event);
    expect(guard({ type: "balance_requested" }, 5, { timeline }).reason).toBe("qc");
    expect(guard({ type: "balance_requested" }, 5, {
      timeline,
      actions: [{ kind: "FINAL_QC_CONFIRMATION", status: "RESPONDED", respondedAt: "2026-07-10", responsePayload: { response: "CONFIRM" } }],
    })).toEqual({ available: true, reason: "" });
  });

  it("requires the customer to report the balance before operations confirms receipt", () => {
    const timeline = ["proposal_sent", "deposit_confirmed", "diamond_locked", "production_started", "qc_ready", "balance_requested"].map(event);
    expect(guard({ type: "balance_confirmed" }, 6, { timeline })).toEqual({ available: false, reason: "balance" });
    expect(guard({ type: "balance_confirmed" }, 6, {
      timeline: [...timeline, event("payment_reported", { kind: "balance" })],
    })).toEqual({ available: true, reason: "" });
  });

  it("requires a complete saved address before shipment", () => {
    const timeline = ["proposal_sent", "deposit_confirmed", "diamond_locked", "production_started", "qc_ready", "balance_requested", "balance_confirmed"].map(event);
    expect(guard({ type: "shipped" }, 7, { timeline })).toEqual({ available: false, reason: "address" });
    expect(guard({ type: "shipped" }, 7, {
      timeline,
      order: { summary: { shippingAddress: {
        recipientName: "Jane", phone: "555-0100", addressLine1: "1 Main St",
        city: "Los Angeles", region: "CA", postalCode: "90001", country: "US",
      } } },
    })).toEqual({ available: true, reason: "" });
  });
});

describe("adminFlowSteps", () => {
  it("removes the duplicate Admin production and QC upload steps for supplier-backed orders", () => {
    const supplierSteps = adminFlowSteps({ jobCode: "JOB-100005" }).map((step) => step.type);
    expect(supplierSteps).not.toContain("production_started");
    expect(supplierSteps).not.toContain("qc_ready");
    expect(supplierSteps).toEqual(expect.arrayContaining(["balance_requested", "shipped", "delivered"]));
  });

  it("keeps the legacy production and QC steps for orders without a supplier", () => {
    const directSteps = adminFlowSteps(null).map((step) => step.type);
    expect(directSteps).toContain("production_started");
    expect(directSteps).toContain("qc_ready");
  });

  it("offers an optional shipment receipt together with required customer tracking", () => {
    const shipped = adminFlowSteps({ jobCode: "JOB-100005" }).find((step) => step.type === "shipped");
    expect(shipped).toMatchObject({ fields: ["tracking"], media: "shipment", artifactType: "SHIPMENT" });
  });
});

describe("buildAdminProgressPhases", () => {
  const progressT = { progressStages: { quote: "Quote", design: "Design", making: "Making", balance: "Balance", delivery: "Delivery" } };

  it("groups the existing Admin actions into five display-only stages", () => {
    const phases = buildAdminProgressPhases({
      order: { stage: "BALANCE" },
      timeline: ["proposal_sent", "deposit_confirmed", "diamond_locked", "production_started", "qc_ready", "balance_requested"].map(event),
      supplierJob: null,
      t: progressT,
    });

    expect(phases.map((phase) => phase.id)).toEqual(["quote", "design", "making", "balance", "delivery"]);
    expect(phases.find((phase) => phase.id === "balance")).toMatchObject({ state: "active", completedSteps: 1 });
    expect(phases.find((phase) => phase.id === "delivery")?.steps.map((step) => step.type)).toEqual(["shipped", "delivered"]);
  });

  it("uses the supplier workspace for production without reintroducing duplicate Admin actions", () => {
    const phases = buildAdminProgressPhases({
      order: { stage: "FINAL_QC" },
      timeline: ["proposal_sent", "deposit_confirmed", "diamond_locked"].map(event),
      supplierJob: { jobCode: "JOB-100005", workflowState: "QC_REVIEW" },
      t: progressT,
    });

    expect(phases.find((phase) => phase.id === "making")).toMatchObject({ state: "active", steps: [] });
  });
});

describe("adminErrorStatus", () => {
  it("shows authentication copy only for authorization errors", () => {
    expect(adminErrorStatus({ status: 401 }, "loading")).toBe("auth");
    expect(adminErrorStatus({ status: 403 }, "loading")).toBe("auth");
    expect(adminErrorStatus({ status: 503 }, "loading")).toBe("error");
  });

  it("distinguishes an unreachable API and preserves already loaded data", () => {
    expect(adminErrorStatus(new ApiUnavailableError(), "loading")).toBe("unavailable");
    expect(adminErrorStatus({ status: 503 }, "ok")).toBe("ok");
  });
});
