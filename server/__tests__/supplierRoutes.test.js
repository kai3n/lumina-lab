import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../app.js";
import { query } from "../db.js";
import { hashPassword } from "../passwords.js";
import { __resetRateLimit } from "../rateLimit.js";
import { drainMail } from "../mailer.js";
import { __resetLocalMediaStateForTests } from "../media.js";
import { truncateAuth, truncateCustomerCore, truncateSuppliers } from "./helpers.js";

const app = createApp();

beforeEach(async () => {
  __resetRateLimit();
  drainMail();
  await truncateSuppliers();
  await truncateCustomerCore();
  await truncateAuth();
});

async function adminCookie() {
  await query("insert into admin_users (email,name,password_hash) values ($1,$2,$3)",
    ["vendor-admin@example.com", "Vendor Admin", hashPassword("admin12345")]);
  const login = await request(app).post("/v1/auth/password")
    .send({ email: "vendor-admin@example.com", password: "admin12345" });
  return login.headers["set-cookie"];
}

async function createOrder(email = "private-customer@example.com") {
  const result = await request(app).post("/v1/intakes").send({
    email,
    name: "Private Customer",
    phone: "+1 555 0100",
    locale: "en",
    category: "ring",
    productLine: "solitaire",
    termsAccepted: true,
    conditional: { ringSize: "6", engraving: "secret" },
  });
  expect(result.status).toBe(201);
  return result.body.orderCode;
}

async function customerCookie(email) {
  const code = await request(app).post("/v1/auth/code").send({ email });
  const verified = await request(app).post("/v1/auth/code/verify").send({ email, code: code.body.devCode });
  return verified.headers["set-cookie"];
}

async function adminOrderState(admin, orderCode) {
  const result = await request(app).get(`/v1/admin/orders/${orderCode}`).set("Cookie", admin);
  expect(result.status).toBe(200);
  return { ...result.body.order, supplierJob: result.body.supplierJob };
}

async function adminOrderByJob(admin, jobCode) {
  const result = await request(app).get("/v1/admin/orders").set("Cookie", admin);
  expect(result.status).toBe(200);
  return result.body.orders.find((order) => order.supplierJob?.jobCode === jobCode);
}

async function inviteAndActivate(admin, email, displayName) {
  const created = await request(app).post("/v1/admin/suppliers").set("Cookie", admin)
    .send({ email, displayName, contactName: displayName, locale: "zh" });
  expect(created.status).toBe(201);
  const supplierCode = created.body.supplier.supplierCode;
  const invitation = await request(app).post(`/v1/admin/suppliers/${supplierCode}/invites`).set("Cookie", admin);
  expect(invitation.status).toBe(201);
  const token = new URL(invitation.body.inviteUrl).searchParams.get("token");
  const accepted = await request(app).post("/v1/vendor/auth/accept-invite")
    .send({ token, password: "vendor-pass-123" });
  expect(accepted.status).toBe(200);
  drainMail();
  return { supplierCode, cookie: accepted.headers["set-cookie"] };
}

async function uploadVerifiedSupplierMedia(vendorCookie, jobCode, purpose, fileName) {
  const bytes = Buffer.from(`${purpose.toLowerCase()}-${fileName}`);
  const signed = await request(app)
    .post(`/v1/vendor/orders/${jobCode}/media/upload-url`)
    .set("Cookie", vendorCookie)
    .send({ purpose, fileName, contentType: "image/jpeg", size: bytes.length });
  expect(signed.status).toBe(201);
  await request(app).put(new URL(signed.body.uploadUrl).pathname)
    .set("Content-Type", "image/jpeg").send(bytes).expect(204);
  const completed = await request(app)
    .post(`/v1/vendor/orders/${jobCode}/media/${signed.body.mediaId}/complete`)
    .set("Cookie", vendorCookie);
  expect(completed.status).toBe(200);
  return { assetId: signed.body.mediaId };
}

async function advanceSolitaireToProduction(admin, vendorCookie, jobCode, orderCode, customerEmail) {
  const accepted = await request(app).post(`/v1/vendor/orders/${jobCode}/stage`).set("Cookie", vendorCookie)
    .send({ type: "ACCEPT" });
  expect(accepted.body.transition.workflowState).toBe("CANDIDATES_REQUIRED");
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "STONE_SELECTION", waitingOn: "EXTERNAL",
    supplierJob: { workflowState: "CANDIDATES_REQUIRED", owner: "VENDOR" },
  });

  const candidates = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendorCookie).send({
    type: "STONE",
    note: "Order-specific candidate batch",
    data: {
      candidateCount: 10,
      batchValidUntil: "2026-08-15",
      temporaryHoldUntil: "2026-08-03T12:00:00.000Z",
      igiNumbers: "IGI-10001\nIGI-10002",
      availabilityConfirmed: true,
    },
  });
  expect(candidates.status).toBe(201);
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "STONE_SELECTION", waitingOn: "BELOVEDIAMOND",
    supplierJob: { workflowState: "CANDIDATES_REVIEW", needsReview: true, pendingReviewCount: 1 },
  });
  expect((await request(app).patch(`/v1/admin/supplier-updates/${candidates.body.update.id}/review`).set("Cookie", admin)
    .send({ status: "approved" })).body.update.status).toBe("approved");
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "STONE_SELECTION", waitingOn: "CUSTOMER",
    supplierJob: { workflowState: "CUSTOMER_STONE_SELECTION", owner: "CUSTOMER", pendingReviewCount: 0 },
  });

  const locked = await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
    .send({ action: "LOCK_DIAMOND", lockedDiamondRef: "IGI-10001" });
  expect(locked.body.job).toMatchObject({ workflowState: "DIAMOND_LOCKED", lockedDiamond: "IGI-10001" });
  expect((await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
    .send({ action: "OPEN_ESTIMATE" })).body.job.workflowState).toBe("ESTIMATE_REQUIRED");
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "QUOTE", waitingOn: "EXTERNAL",
    supplierJob: { workflowState: "ESTIMATE_REQUIRED", owner: "VENDOR" },
  });

  const estimate = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendorCookie).send({
    type: "ESTIMATE",
    note: "Supplier cost estimate only",
    data: {
      netWeightG: 4.8,
      lossPct: 6,
      laborCost: 1200,
      materialCost: 300,
      leadTimeDays: 18,
      currency: "CNY",
      assumptions: "PT950, US size 6, selected 1.5ct center stone",
    },
  });
  expect(estimate.status).toBe(201);
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "QUOTE", waitingOn: "BELOVEDIAMOND",
    supplierJob: { workflowState: "ESTIMATE_REVIEW", needsReview: true },
  });
  await request(app).patch(`/v1/admin/supplier-updates/${estimate.body.update.id}/review`).set("Cookie", admin)
    .send({ status: "approved" });
  const duplicateQuoteTransition = await request(app)
    .post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
    .send({ action: "PREPARE_QUOTE" });
  expect(duplicateQuoteTransition.status).toBe(400);

  const proposal = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", admin).send({
    type: "proposal_sent",
    artifact: { type: "QUOTE", payload: { totalUsd: 1000, depositUsd: 300 } },
    action: { kind: "QUOTE_ACCEPTANCE", allowedResponses: ["APPROVE", "REQUEST_CHANGES"] },
  });
  expect(proposal.status).toBe(201);
  expect((await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
    .send({ action: "CUSTOMER_ACCEPT_QUOTE" })).status).toBe(400);

  const customer = await customerCookie(customerEmail);
  expect((await request(app).post(`/v1/actions/${proposal.body.actionCode}/respond`).set("Cookie", customer)
    .send({ response: "APPROVE" })).status).toBe(200);
  expect((await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
    .send({ action: "CONFIRM_DEPOSIT" })).status).toBe(400);
  expect((await request(app).post(`/v1/orders/${orderCode}/shipping-address`).set("Cookie", customer).send({
    recipientName: "Inventory Owner",
    phone: "+1 555 010 2000",
    addressLine1: "1 Verified Way",
    city: "Los Angeles",
    region: "CA",
    postalCode: "90001",
    country: "US",
  })).status).toBe(200);
  expect((await request(app).post(`/v1/orders/${orderCode}/payment-reported`).set("Cookie", customer)
    .send({ kind: "deposit" })).status).toBe(200);
  const deposit = await request(app).post(`/v1/admin/orders/${orderCode}/events`).set("Cookie", admin)
    .send({ type: "deposit_confirmed" });
  expect(deposit.status).toBe(201);
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "CAD", waitingOn: "EXTERNAL",
    supplierJob: { workflowState: "DESIGN_REQUIRED", owner: "VENDOR" },
  });

  const cadMedia = await uploadVerifiedSupplierMedia(vendorCookie, jobCode, "CAD", "cad-v1.jpg");
  const cad = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendorCookie)
    .send({ type: "CAD", note: "CAD v1", media: [cadMedia] });
  expect(cad.status).toBe(201);
  const adminList = await request(app).get("/v1/admin/orders").set("Cookie", admin);
  expect(adminList.body.orders.find((order) => order.supplierJob?.jobCode === jobCode)?.supplierJob)
    .toMatchObject({ needsReview: true, pendingReviewCount: 1, action: "REVIEW_CAD" });
  const review = await request(app).patch(`/v1/admin/supplier-updates/${cad.body.update.id}/review`).set("Cookie", admin)
    .send({ status: "approved" });
  expect(review.status).toBe(200);
  expect(review.body.update).toMatchObject({ workflowState: "CUSTOMER_CAD_REVIEW" });
  expect(review.body.update.customerActionCode).toBeTruthy();
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "CAD", waitingOn: "CUSTOMER",
    supplierJob: { workflowState: "CUSTOMER_CAD_REVIEW", owner: "CUSTOMER" },
  });

  const changes = await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`)
    .set("Cookie", admin).send({ action: "REQUEST_CHANGES", reviewNote: "Customer asked for a lower profile" });
  expect(changes.body.job).toMatchObject({
    workflowState: "DESIGN_CHANGES",
    customerActionCode: review.body.update.customerActionCode,
  });
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "CAD", waitingOn: "EXTERNAL",
    supplierJob: { workflowState: "DESIGN_CHANGES", owner: "VENDOR" },
  });

  const cadV2Media = await uploadVerifiedSupplierMedia(vendorCookie, jobCode, "CAD", "cad-v2.jpg");
  const cadV2 = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendorCookie)
    .send({ type: "CAD", note: "CAD v2 — lower profile", media: [cadV2Media] });
  expect(cadV2.status).toBe(201);
  const reviewV2 = await request(app).patch(`/v1/admin/supplier-updates/${cadV2.body.update.id}/review`).set("Cookie", admin)
    .send({ status: "approved" });
  expect(reviewV2.body.update).toMatchObject({ workflowState: "CUSTOMER_CAD_REVIEW" });

  const approved = await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`)
    .set("Cookie", admin).send({ action: "APPROVE" });
  expect(approved.body.job).toMatchObject({
    workflowState: "DESIGN_APPROVED",
    customerActionCode: reviewV2.body.update.customerActionCode,
  });
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "CAD", waitingOn: "EXTERNAL",
    supplierJob: { workflowState: "DESIGN_APPROVED", owner: "VENDOR" },
  });
  const orderAfterApproval = await adminOrderByJob(admin, jobCode);
  const approvalDetail = await request(app).get(`/v1/admin/orders/${orderAfterApproval.orderCode}`).set("Cookie", admin);
  expect(approvalDetail.body.actions.find((action) => action.id === reviewV2.body.update.customerActionCode)).toMatchObject({
    status: "RESPONDED",
    responsePayload: { response: "APPROVE", source: "ADMIN_RECORDED" },
  });
  expect(approvalDetail.body.actions.find((action) => action.id === review.body.update.customerActionCode)).toMatchObject({
    status: "RESPONDED",
    responsePayload: { response: "REQUEST_CHANGES", source: "ADMIN_RECORDED", message: "Customer asked for a lower profile" },
  });
  const production = await request(app).post(`/v1/vendor/orders/${jobCode}/stage`).set("Cookie", vendorCookie)
    .send({ type: "CONFIRM_PRODUCTION" });
  expect(production.body.transition.workflowState).toBe("IN_PRODUCTION");
  expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
    stage: "PRODUCTION", waitingOn: "EXTERNAL",
    supplierJob: { workflowState: "IN_PRODUCTION", owner: "VENDOR" },
  });
}

describe("one account per vendor", () => {
  it("uses the supplier session when the browser also has an admin cookie", async () => {
    const admin = await adminCookie();
    const vendor = await inviteAndActivate(admin, "dual-session-vendor@example.com", "Dual Session Vendor");
    const mixedCookie = [...admin, ...vendor.cookie];

    const me = await request(app).get("/v1/vendor/me").set("Cookie", mixedCookie);

    expect(me.status).toBe(200);
    expect(me.body.supplier.email).toBe("dual-session-vendor@example.com");
  });

  it("binds a verified upload to the vendor job and exposes it in the admin order detail", async () => {
    const localRoot = await mkdtemp(join(tmpdir(), "beloved-vendor-media-"));
    process.env.LOCAL_MEDIA_ROOT = localRoot;
    process.env.VENDOR_MEDIA_PROVIDER = "local";
    __resetLocalMediaStateForTests();
    try {
      const admin = await adminCookie();
      const orderCode = await createOrder("media-order@example.com");
      const vendor = await inviteAndActivate(admin, "media-vendor@example.com", "Media Vendor");
      const assignment = await request(app).post(`/v1/admin/orders/${orderCode}/supplier`).set("Cookie", admin)
        .send({ supplierCode: vendor.supplierCode });
      const jobCode = assignment.body.assignment.jobCode;
      await request(app).post(`/v1/vendor/orders/${jobCode}/stage`).set("Cookie", vendor.cookie)
        .send({ type: "ACCEPT" }).expect(201);

      const bytes = Buffer.from("vendor-order-video");
      const signed = await request(app)
        .post(`/v1/vendor/orders/${jobCode}/media/upload-url`)
        .set("Cookie", vendor.cookie)
        .send({ purpose: "STONE", fileName: "candidate.mp4", contentType: "video/mp4", size: bytes.length });
      expect(signed.status).toBe(201);
      expect(signed.body.key).toMatch(new RegExp(`^vendor/[0-9]+/${jobCode.toLowerCase()}/proposal/`));
      const premature = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendor.cookie).send({
        type: "STONE",
        media: [{ assetId: signed.body.mediaId }],
        data: { candidateCount: 1, batchValidUntil: "2026-08-15", igiNumbers: "IGI-20001", availabilityConfirmed: true },
      });
      expect(premature.status).toBe(409);
      expect(premature.body.error.code).toBe("MEDIA_NOT_READY");
      await request(app).put(new URL(signed.body.uploadUrl).pathname)
        .set("Content-Type", "video/mp4").send(bytes).expect(204);
      const completed = await request(app)
        .post(`/v1/vendor/orders/${jobCode}/media/${signed.body.mediaId}/complete`)
        .set("Cookie", vendor.cookie);
      expect(completed.status).toBe(200);
      expect(completed.body.media).toMatchObject({ assetId: signed.body.mediaId, type: "video/mp4", size: bytes.length });

      const update = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendor.cookie).send({
        type: "STONE",
        note: "Candidate video",
        media: [{ assetId: signed.body.mediaId }],
        data: {
          candidateCount: 1,
          batchValidUntil: "2026-08-15",
          igiNumbers: "IGI-20001",
          availabilityConfirmed: true,
        },
      });
      expect(update.status).toBe(201);
      expect(update.body.update.media[0].assetId).toBe(signed.body.mediaId);

      const adminDetail = await request(app).get(`/v1/admin/orders/${orderCode}`).set("Cookie", admin);
      expect(adminDetail.status).toBe(200);
      expect(adminDetail.body.supplierJob).toMatchObject({ jobCode, workflowState: "CANDIDATES_REVIEW" });
      expect(adminDetail.body.supplierJob.updates[0].media[0]).toMatchObject({
        assetId: signed.body.mediaId,
        type: "video/mp4",
      });
      expect(adminDetail.body.supplierJob.updates[0].media[0].url).toContain(`/v1/media/local/vendor/`);
    } finally {
      delete process.env.VENDOR_MEDIA_PROVIDER;
      delete process.env.LOCAL_MEDIA_ROOT;
      __resetLocalMediaStateForTests();
      await rm(localRoot, { recursive: true, force: true });
    }
  });

  it("defaults activation links to the same-origin /vendor/ app", async () => {
    const previousAppUrl = process.env.VENDOR_APP_URL;
    const previousVendorOrigin = process.env.VENDOR_ORIGIN;
    delete process.env.VENDOR_APP_URL;
    process.env.VENDOR_ORIGIN = "https://belovediamond.com";
    try {
      const admin = await adminCookie();
      const created = await request(app).post("/v1/admin/suppliers").set("Cookie", admin).send({
        email: "same-origin-vendor@example.com", displayName: "Same Origin Vendor", contactName: "Vendor Contact", locale: "zh",
      });
      const invitation = await request(app)
        .post(`/v1/admin/suppliers/${created.body.supplier.supplierCode}/invites`)
        .set("Cookie", admin);
      const inviteUrl = new URL(invitation.body.inviteUrl);
      expect(inviteUrl.origin).toBe("https://belovediamond.com");
      expect(inviteUrl.pathname).toBe("/vendor/");
      expect(inviteUrl.searchParams.get("token")).toBeTruthy();
    } finally {
      if (previousAppUrl === undefined) delete process.env.VENDOR_APP_URL;
      else process.env.VENDOR_APP_URL = previousAppUrl;
      if (previousVendorOrigin === undefined) delete process.env.VENDOR_ORIGIN;
      else process.env.VENDOR_ORIGIN = previousVendorOrigin;
    }
  });

  it("emails a subpath-safe activation link and exposes the pending invitation state", async () => {
    const previousAppUrl = process.env.VENDOR_APP_URL;
    process.env.VENDOR_APP_URL = "https://vendor.example.com/BeloveD/vendor/";
    try {
      const admin = await adminCookie();
      const created = await request(app).post("/v1/admin/suppliers").set("Cookie", admin).send({
        email: "new-vendor@example.com", displayName: "New Vendor", contactName: "Vendor Contact", locale: "en",
      });
      const supplierCode = created.body.supplier.supplierCode;
      const invitation = await request(app).post(`/v1/admin/suppliers/${supplierCode}/invites`).set("Cookie", admin);
      expect(invitation.status).toBe(201);
      expect(invitation.body.emailSent).toBe(true);
      const inviteUrl = new URL(invitation.body.inviteUrl);
      expect(inviteUrl.pathname).toBe("/BeloveD/vendor/");
      expect(inviteUrl.searchParams.get("token")).toBeTruthy();
      expect(drainMail()).toEqual([expect.objectContaining({
        type: "vendor_invite", to: "new-vendor@example.com", link: invitation.body.inviteUrl, locale: "en",
      })]);

      const directory = await request(app).get("/v1/admin/suppliers").set("Cookie", admin);
      expect(directory.body.suppliers[0]).toMatchObject({ supplierCode, status: "invited" });
      expect(directory.body.suppliers[0].invitedAt).toBeTruthy();
      expect(directory.body.suppliers[0].inviteExpiresAt).toBeTruthy();
    } finally {
      if (previousAppUrl === undefined) delete process.env.VENDOR_APP_URL;
      else process.env.VENDOR_APP_URL = previousAppUrl;
    }
  });

  it("resets a vendor password with a one-time link while keeping existing sessions", async () => {
    const admin = await adminCookie();
    const email = "password-reset@example.com";
    const vendor = await inviteAndActivate(admin, email, "Password Reset Vendor");

    const unknown = await request(app).post("/v1/vendor/auth/password-reset/request")
      .send({ email: "unknown@example.com" });
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual({ ok: true });
    expect(drainMail()).toEqual([]);

    const requested = await request(app).post("/v1/vendor/auth/password-reset/request").send({ email });
    expect(requested.status).toBe(202);
    expect(requested.body).toEqual({ ok: true });
    const messages = drainMail();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "vendor_password_reset", to: email, locale: "zh" });
    const resetToken = new URL(messages[0].link).searchParams.get("reset");
    expect(resetToken).toBeTruthy();

    const reset = await request(app).post("/v1/vendor/auth/password-reset/confirm")
      .send({ token: resetToken, password: "new-vendor-pass-456" });
    expect(reset.status).toBe(200);
    expect(reset.body.supplier.email).toBe(email);
    const newCookie = reset.headers["set-cookie"];

    expect((await request(app).get("/v1/vendor/me").set("Cookie", vendor.cookie)).status).toBe(200);
    expect((await request(app).get("/v1/vendor/me").set("Cookie", newCookie)).status).toBe(200);
    expect((await request(app).post("/v1/vendor/auth/password")
      .send({ email, password: "vendor-pass-123" })).status).toBe(401);
    expect((await request(app).post("/v1/vendor/auth/password")
      .send({ email, password: "new-vendor-pass-456" })).status).toBe(200);

    const reused = await request(app).post("/v1/vendor/auth/password-reset/confirm")
      .send({ token: resetToken, password: "another-vendor-pass-789" });
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe("SUPPLIER_PASSWORD_RESET_INVALID");
  });

  it("invites the vendor, assigns only its order, and strips customer PII", async () => {
    const admin = await adminCookie();
    const orderCode = await createOrder();
    const first = await inviteAndActivate(admin, "factory-one@example.com", "Factory One");
    const second = await inviteAndActivate(admin, "factory-two@example.com", "Factory Two");

    const assigned = await request(app).post(`/v1/admin/orders/${orderCode}/supplier`).set("Cookie", admin)
      .send({ supplierCode: first.supplierCode, dueAt: "2026-08-01T00:00:00.000Z" });
    expect(assigned.status).toBe(201);
    const jobCode = assigned.body.assignment.jobCode;
    expect(jobCode).toBe(orderCode.replace(/^BD-/, "JOB-"));
    expect(await adminOrderState(admin, orderCode)).toMatchObject({
      stage: "OPS_REVIEW", waitingOn: "EXTERNAL",
      supplierJob: { jobCode, workflowState: "ASSIGNED", owner: "VENDOR" },
    });

    const own = await request(app).get(`/v1/vendor/orders/${jobCode}`).set("Cookie", first.cookie);
    expect(own.status).toBe(200);
    expect(own.body.order.jobCode).toBe(jobCode);
    expect(own.body.order.workflowState).toBe("ASSIGNED");
    expect(JSON.stringify(own.body)).not.toContain(orderCode);
    expect(JSON.stringify(own.body)).not.toContain("private-customer@example.com");
    expect(JSON.stringify(own.body)).not.toContain("Private Customer");
    expect(JSON.stringify(own.body)).not.toContain("+1 555 0100");

    const otherList = await request(app).get("/v1/vendor/orders").set("Cookie", second.cookie);
    expect(otherList.status).toBe(200);
    expect(otherList.body.orders).toEqual([]);
    const otherDetail = await request(app).get(`/v1/vendor/orders/${jobCode}`).set("Cookie", second.cookie);
    expect(otherDetail.status).toBe(403);
    expect(otherDetail.body.error.code).toBe("ORDER_ACCESS_DENIED");
  });

  it("scopes updates and inventory to the logged-in vendor", async () => {
    const admin = await adminCookie();
    const orderCode = await createOrder("inventory-owner@example.com");
    const first = await inviteAndActivate(admin, "inventory-one@example.com", "Inventory One");
    const second = await inviteAndActivate(admin, "inventory-two@example.com", "Inventory Two");
    const assignment = await request(app).post(`/v1/admin/orders/${orderCode}/supplier`).set("Cookie", admin)
      .send({ supplierCode: first.supplierCode });
    const jobCode = assignment.body.assignment.jobCode;

    await advanceSolitaireToProduction(admin, first.cookie, jobCode, orderCode, "inventory-owner@example.com");

    const progressMedia = await uploadVerifiedSupplierMedia(first.cookie, jobCode, "PROGRESS", "progress.jpg");
    const update = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", first.cookie)
      .send({ type: "PROGRESS", note: "Setting complete", media: [progressMedia] });
    expect(update.status).toBe(201);
    expect(update.body.update.version).toBe(1);
    expect(update.body.update.status).toBe("submitted");
    const progressReview = await request(app).patch(`/v1/admin/supplier-updates/${update.body.update.id}/review`).set("Cookie", admin)
      .send({ status: "approved" });
    expect(progressReview.status).toBe(200);
    expect(progressReview.body.update.workflowState).toBe("IN_PRODUCTION");
    const replacement = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", first.cookie)
      .send({ type: "PROGRESS", note: "Updated setting" });
    expect(replacement.body.update.version).toBe(2);
    const detail = await request(app).get(`/v1/vendor/orders/${jobCode}`).set("Cookie", first.cookie);
    expect(detail.body.order.workflowState).toBe("PROGRESS_REVIEW");
    expect(detail.body.order.updates[0]).toMatchObject({ version: 2, status: "submitted" });
    expect(detail.body.order.updates[1]).toMatchObject({ version: 1, status: "approved" });
    await request(app).patch(`/v1/admin/supplier-updates/${replacement.body.update.id}/review`).set("Cookie", admin)
      .send({ status: "approved" }).expect(200);
    const openQc = await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
      .send({ action: "OPEN_QC" });
    expect(openQc.body.job.workflowState).toBe("QC_REQUIRED");
    const qcMedia = await uploadVerifiedSupplierMedia(first.cookie, jobCode, "QC", "final-qc.jpg");
    const qc = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", first.cookie)
      .send({ type: "QC", note: "Final QC", media: [qcMedia] });
    expect(qc.status).toBe(201);
    const qcReview = await request(app).patch(`/v1/admin/supplier-updates/${qc.body.update.id}/review`).set("Cookie", admin)
      .send({ status: "approved" });
    expect(qcReview.body.update).toMatchObject({ workflowState: "CUSTOMER_QC_REVIEW" });
    expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
      stage: "FINAL_QC", waitingOn: "BELOVEDIAMOND",
      supplierJob: { workflowState: "CUSTOMER_QC_REVIEW", owner: "OPERATIONS", action: "RECORD_QC_DECISION" },
    });
    const qcConfirmed = await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
      .send({ action: "CONFIRM_QC" });
    expect(qcConfirmed.body.job).toMatchObject({
      workflowState: "QC_APPROVED",
      customerActionCode: qcReview.body.update.customerActionCode,
    });
    const qcDetail = await request(app).get(`/v1/admin/orders/${orderCode}`).set("Cookie", admin);
    expect(qcDetail.body.actions.find((action) => action.id === qcReview.body.update.customerActionCode)).toMatchObject({
      status: "RESPONDED",
      responsePayload: { response: "CONFIRM", source: "ADMIN_RECORDED" },
    });
    expect((await request(app).get(`/v1/vendor/orders/${jobCode}`).set("Cookie", first.cookie)).body.order)
      .toMatchObject({ workflowState: "QC_APPROVED", owner: "VENDOR", action: "SUBMIT_SHIPPING" });
    const shippingMedia = await uploadVerifiedSupplierMedia(first.cookie, jobCode, "SHIPPING", "shipping-receipt.jpg");
    const shipping = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", first.cookie)
      .send({
        type: "SHIPPING",
        note: "Package handed to carrier",
        data: { trackingNumber: "SF-TEST-10001" },
        media: [shippingMedia],
      });
    expect(shipping.status).toBe(201);
    expect(shipping.body.update).toMatchObject({ type: "SHIPPING", status: "approved", data: { trackingNumber: "SF-TEST-10001" } });
    expect(await adminOrderByJob(admin, jobCode)).toMatchObject({
      supplierJob: { workflowState: "HANDOFF_READY", owner: "OPERATIONS", action: "CONFIRM_RECEIPT" },
    });
    const supplierReceipt = await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/complete`).set("Cookie", admin);
    expect(supplierReceipt.body.job.workflowState).toBe("COMPLETED");
    expect((await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", second.cookie)
      .send({ type: "PROGRESS", note: "intrusion" })).status).toBe(403);

    const created = await request(app).post("/v1/vendor/inventory").set("Cookie", first.cookie).send({
      supplierSku: "STONE-001", certificateNo: "IGI-1", shape: "round", carat: 1.25,
      color: "E", clarity: "VS1", procurementCostUsd: 500,
    });
    expect(created.status).toBe(201);
    const inventoryId = created.body.stone.id;
    expect((await request(app).get("/v1/vendor/inventory").set("Cookie", second.cookie)).body.inventory).toEqual([]);
    const otherPatch = await request(app).patch(`/v1/vendor/inventory/${inventoryId}`).set("Cookie", second.cookie)
      .send({ availability: "sold" });
    expect(otherPatch.status).toBe(404);
  });

  it("revokes live sessions when an admin suspends a vendor", async () => {
    const admin = await adminCookie();
    const vendor = await inviteAndActivate(admin, "suspend@example.com", "Suspend Me");
    expect((await request(app).get("/v1/vendor/me").set("Cookie", vendor.cookie)).status).toBe(200);
    const suspended = await request(app).patch(`/v1/admin/suppliers/${vendor.supplierCode}`).set("Cookie", admin)
      .send({ status: "suspended" });
    expect(suspended.status).toBe(200);
    expect((await request(app).get("/v1/vendor/me").set("Cookie", vendor.cookie)).status).toBe(401);
  });
});
