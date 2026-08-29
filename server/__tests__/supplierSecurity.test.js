import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { cancelOrder, recordOrderEvent } from "../customerRepository.js";
import { query } from "../db.js";
import { hashPassword } from "../passwords.js";
import { __resetRateLimit } from "../rateLimit.js";
import { drainMail } from "../mailer.js";
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
  await query(
    "insert into admin_users (email,name,password_hash) values ($1,$2,$3)",
    ["supplier-security-admin@example.com", "Supplier Security Admin", hashPassword("admin12345")],
  );
  const login = await request(app).post("/v1/auth/password")
    .send({ email: "supplier-security-admin@example.com", password: "admin12345" });
  return login.headers["set-cookie"];
}

async function createOrder(email) {
  const result = await request(app).post("/v1/intakes").send({
    email,
    name: "Supplier Security Customer",
    locale: "en",
    category: "ring",
    productLine: "solitaire",
    termsAccepted: true,
    conditional: { ringSize: "6" },
  });
  expect(result.status).toBe(201);
  return result.body.orderCode;
}

async function inviteAndActivate(admin, email = "supplier-security-vendor@example.com") {
  const created = await request(app).post("/v1/admin/suppliers").set("Cookie", admin).send({
    email,
    displayName: "Supplier Security Vendor",
    contactName: "Vendor Contact",
    locale: "en",
  });
  expect(created.status).toBe(201);
  const supplierCode = created.body.supplier.supplierCode;
  const invitation = await request(app)
    .post(`/v1/admin/suppliers/${supplierCode}/invites`)
    .set("Cookie", admin);
  const token = new URL(invitation.body.inviteUrl).searchParams.get("token");
  const accepted = await request(app).post("/v1/vendor/auth/accept-invite")
    .send({ token, password: "vendor-pass-123" });
  expect(accepted.status).toBe(200);
  drainMail();
  return { supplierCode, cookie: accepted.headers["set-cookie"] };
}

async function assignOrder(admin, vendor, orderCode) {
  const assigned = await request(app).post(`/v1/admin/orders/${orderCode}/supplier`)
    .set("Cookie", admin)
    .send({ supplierCode: vendor.supplierCode });
  expect(assigned.status).toBe(201);
  return assigned.body.assignment.jobCode;
}

async function assignmentFor(jobCode) {
  return (await query(`
    select a.id, a.order_id, a.supplier_id, a.status, a.workflow_state, a.revoked_at
    from supplier_order_assignments a where a.job_code=$1
  `, [jobCode])).rows[0];
}

async function insertMediaAsset(jobCode, { purpose = "STONE", status = "PENDING", verified = false } = {}) {
  const assignment = await assignmentFor(jobCode);
  const sequence = (await query("select nextval('media_code_seq') as n")).rows[0].n;
  const mediaCode = `MED-${String(sequence).padStart(6, "0")}`;
  const key = `vendor/${assignment.supplier_id}/${jobCode.toLowerCase()}/proposal/2026-08-29/0123456789abcdef01234567.jpg`;
  await query(`
    insert into media_assets
      (media_code, owner_supplier_id, order_id, supplier_assignment_id, status,
       kind, mime_type, byte_size, storage_key, provider, purpose, verified_at, public_payload)
    values ($1,$2,$3,$4,$5,'image','image/jpeg',10,$6,'local',$7,$8,$9)
  `, [mediaCode, assignment.supplier_id, assignment.order_id, assignment.id, status, key, purpose,
    verified ? new Date() : null, { fileName: "candidate.jpg", localUrl: "https://legacy.example/candidate.jpg" }]);
  return { mediaCode, key, assignment };
}

async function setupAssignedOrder(customerEmail) {
  const admin = await adminCookie();
  const orderCode = await createOrder(customerEmail);
  const vendor = await inviteAndActivate(admin);
  const jobCode = await assignOrder(admin, vendor, orderCode);
  return { admin, orderCode, vendor, jobCode, customerEmail };
}

describe("supplier media write boundary", () => {
  it("rejects arbitrary HTTPS and raw supplier keys on writes while legacy rows remain readable", async () => {
    const { jobCode, vendor } = await setupAssignedOrder("legacy-media-reader@example.com");
    await request(app).post(`/v1/vendor/orders/${jobCode}/stage`).set("Cookie", vendor.cookie)
      .send({ type: "ACCEPT" }).expect(201);
    const assignment = await assignmentFor(jobCode);
    const rawKey = `vendor/${assignment.supplier_id}/${jobCode.toLowerCase()}/proposal/2026-08-29/abcdefabcdefabcdefabcdef.jpg`;

    const arbitraryUrl = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`)
      .set("Cookie", vendor.cookie)
      .send({ type: "NOTE", media: [{ url: "https://attacker.example/unverified.jpg" }] });
    expect(arbitraryUrl.status).toBe(400);
    expect(arbitraryUrl.body.error.code).toBe("VALIDATION_ERROR");

    const rawObjectKey = await request(app).post(`/v1/vendor/orders/${jobCode}/updates`)
      .set("Cookie", vendor.cookie)
      .send({ type: "NOTE", media: [{ key: rawKey, provider: "local" }] });
    expect(rawObjectKey.status).toBe(400);
    expect(rawObjectKey.body.error.code).toBe("VALIDATION_ERROR");

    await query(`
      insert into supplier_updates
        (supplier_id, order_id, update_type, note, media, review_status)
      values ($1,$2,'NOTE','legacy media',$3,'approved')
    `, [assignment.supplier_id, assignment.order_id, JSON.stringify([
      { name: "legacy-url.jpg", url: "https://legacy.example/url.jpg" },
      { name: "legacy-key.jpg", key: rawKey, provider: "local", url: "https://legacy.example/key.jpg" },
    ])]);
    const detail = await request(app).get(`/v1/vendor/orders/${jobCode}`).set("Cookie", vendor.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.order.updates[0].media).toEqual([
      expect.objectContaining({ url: "https://legacy.example/url.jpg" }),
      expect.objectContaining({ key: rawKey, url: "https://legacy.example/key.jpg" }),
    ]);
  });

  it("requires a verified READY asset bound to the same order, assignment, and purpose", async () => {
    const admin = await adminCookie();
    const firstOrder = await createOrder("asset-order-one@example.com");
    const secondOrder = await createOrder("asset-order-two@example.com");
    const vendor = await inviteAndActivate(admin);
    const firstJob = await assignOrder(admin, vendor, firstOrder);
    const secondJob = await assignOrder(admin, vendor, secondOrder);
    for (const jobCode of [firstJob, secondJob]) {
      await request(app).post(`/v1/vendor/orders/${jobCode}/stage`).set("Cookie", vendor.cookie)
        .send({ type: "ACCEPT" }).expect(201);
    }
    const asset = await insertMediaAsset(firstJob);
    const stoneData = {
      candidateCount: 1,
      batchValidUntil: "2026-09-15",
      igiNumbers: "IGI-SECURITY-1",
      availabilityConfirmed: true,
    };

    const pending = await request(app).post(`/v1/vendor/orders/${firstJob}/updates`)
      .set("Cookie", vendor.cookie)
      .send({ type: "STONE", media: [{ assetId: asset.mediaCode }], data: stoneData });
    expect(pending.status).toBe(409);
    expect(pending.body.error.code).toBe("MEDIA_NOT_READY");

    await query("update media_assets set status='READY' where media_code=$1", [asset.mediaCode]);
    const readyButUnverified = await request(app).post(`/v1/vendor/orders/${firstJob}/updates`)
      .set("Cookie", vendor.cookie)
      .send({ type: "STONE", media: [{ assetId: asset.mediaCode }], data: stoneData });
    expect(readyButUnverified.status).toBe(409);
    expect(readyButUnverified.body.error.code).toBe("MEDIA_NOT_READY");

    await query("update media_assets set verified_at=now() where media_code=$1", [asset.mediaCode]);
    const crossOrder = await request(app).post(`/v1/vendor/orders/${secondJob}/updates`)
      .set("Cookie", vendor.cookie)
      .send({ type: "STONE", media: [{ assetId: asset.mediaCode }], data: stoneData });
    expect(crossOrder.status).toBe(409);
    expect(crossOrder.body.error.code).toBe("MEDIA_NOT_READY");

    const wrongPurpose = await request(app).post(`/v1/vendor/orders/${firstJob}/updates`)
      .set("Cookie", vendor.cookie)
      .send({ type: "NOTE", media: [{ assetId: asset.mediaCode }] });
    expect(wrongPurpose.status).toBe(409);
    expect(wrongPurpose.body.error.code).toBe("MEDIA_PURPOSE_MISMATCH");

    const valid = await request(app).post(`/v1/vendor/orders/${firstJob}/updates`)
      .set("Cookie", vendor.cookie)
      .send({ type: "STONE", media: [{ assetId: asset.mediaCode }], data: stoneData });
    expect(valid.status).toBe(201);
    expect(valid.body.update.media[0]).toMatchObject({ assetId: asset.mediaCode, key: asset.key });
  });
});

describe("supplier workflow cancellation boundary", () => {
  it("rejects pre-existing active assignments on cancelled or pending-cancel orders", async () => {
    const { admin, orderCode, vendor, jobCode } = await setupAssignedOrder("stale-cancel-security@example.com");
    await query("update customer_orders set stage='CANCELLED', phase='CLOSED' where order_code=$1", [orderCode]);

    const cancelledAccept = await request(app).post(`/v1/vendor/orders/${jobCode}/stage`)
      .set("Cookie", vendor.cookie).send({ type: "ACCEPT" });
    expect(cancelledAccept.status).toBe(409);
    expect(cancelledAccept.body.error.code).toBe("INVALID_SUPPLIER_WORKFLOW_TRANSITION");
    await request(app).post(`/v1/vendor/orders/${jobCode}/media/upload-url`).set("Cookie", vendor.cookie)
      .send({ purpose: "STONE", fileName: "blocked.jpg", contentType: "image/jpeg", size: 10 }).expect(409);
    await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
      .send({ action: "LOCK_DIAMOND", lockedDiamondRef: "IGI-BLOCKED" }).expect(409);

    const order = (await query("select id from customer_orders where order_code=$1", [orderCode])).rows[0];
    await query("update customer_orders set stage='CAD', phase='APPROVE_DESIGN' where id=$1", [order.id]);
    await query(`
      insert into customer_timeline_events (event_code, order_id, title, payload)
      values ('TL-STALE-CANCEL-REQUEST', $1, 'cancel_requested', '{"type":"cancel_requested"}'::jsonb)
    `, [order.id]);
    const pendingAccept = await request(app).post(`/v1/vendor/orders/${jobCode}/stage`)
      .set("Cookie", vendor.cookie).send({ type: "ACCEPT" });
    expect(pendingAccept.status).toBe(409);
    expect(pendingAccept.body.error.code).toBe("CANCELLATION_PENDING");
    await request(app).post(`/v1/admin/orders/${orderCode}/supplier`).set("Cookie", admin)
      .send({ supplierCode: vendor.supplierCode }).expect(409);
  });

  it("revokes a direct cancellation before a vendor can accept, update, or upload", async () => {
    const { admin, orderCode, vendor, jobCode, customerEmail } = await setupAssignedOrder("direct-cancel-security@example.com");

    await expect(cancelOrder(orderCode, customerEmail, "stop before work"))
      .resolves.toMatchObject({ cancelled: true });
    expect(await assignmentFor(jobCode)).toMatchObject({ status: "revoked", revoked_at: expect.any(Date) });

    await request(app).post(`/v1/vendor/orders/${jobCode}/stage`).set("Cookie", vendor.cookie)
      .send({ type: "ACCEPT" }).expect(403);
    await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendor.cookie)
      .send({ type: "NOTE", note: "must not write" }).expect(403);
    await request(app).post(`/v1/vendor/orders/${jobCode}/media/upload-url`).set("Cookie", vendor.cookie)
      .send({ purpose: "STONE", fileName: "blocked.jpg", contentType: "image/jpeg", size: 10 }).expect(403);
    await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
      .send({ action: "LOCK_DIAMOND", lockedDiamondRef: "IGI-BLOCKED" }).expect(404);
    await request(app).post(`/v1/admin/orders/${orderCode}/supplier`).set("Cookie", admin)
      .send({ supplierCode: vendor.supplierCode }).expect(409);
  });

  it("freezes a pending cancellation before a vendor transition and prevents reassignment", async () => {
    const { admin, orderCode, vendor, jobCode, customerEmail } = await setupAssignedOrder("pending-cancel-security@example.com");
    await query("update customer_orders set stage='CAD', phase='APPROVE_DESIGN' where order_code=$1", [orderCode]);
    await query("update supplier_order_assignments set workflow_state='DESIGN_APPROVED' where job_code=$1", [jobCode]);

    await expect(cancelOrder(orderCode, customerEmail, "stop before production"))
      .resolves.toMatchObject({ requested: true });
    expect(await assignmentFor(jobCode)).toMatchObject({
      status: "revoked", workflow_state: "DESIGN_APPROVED", revoked_at: expect.any(Date),
    });

    await request(app).post(`/v1/vendor/orders/${jobCode}/stage`).set("Cookie", vendor.cookie)
      .send({ type: "CONFIRM_PRODUCTION" }).expect(403);
    await request(app).post(`/v1/vendor/orders/${jobCode}/media/upload-url`).set("Cookie", vendor.cookie)
      .send({ purpose: "CAD", fileName: "blocked.jpg", contentType: "image/jpeg", size: 10 }).expect(403);
    await request(app).post(`/v1/admin/orders/${orderCode}/supplier`).set("Cookie", admin)
      .send({ supplierCode: vendor.supplierCode }).expect(409);
  });

  it("revokes on admin order_cancelled so vendor and admin supplier paths cannot advance", async () => {
    const { admin, orderCode, vendor, jobCode } = await setupAssignedOrder("admin-cancel-security@example.com");
    await query("update customer_orders set stage='PRODUCTION', phase='MAKING' where order_code=$1", [orderCode]);
    await query("update supplier_order_assignments set workflow_state='IN_PRODUCTION' where job_code=$1", [jobCode]);

    await expect(recordOrderEvent(orderCode, "order_cancelled"))
      .resolves.toMatchObject({ stage: "CANCELLED" });
    expect(await assignmentFor(jobCode)).toMatchObject({
      status: "revoked", workflow_state: "IN_PRODUCTION", revoked_at: expect.any(Date),
    });

    await request(app).post(`/v1/vendor/orders/${jobCode}/updates`).set("Cookie", vendor.cookie)
      .send({ type: "PROGRESS", note: "must not advance" }).expect(403);
    await request(app).post(`/v1/vendor/orders/${jobCode}/media/upload-url`).set("Cookie", vendor.cookie)
      .send({ purpose: "PROGRESS", fileName: "blocked.jpg", contentType: "image/jpeg", size: 10 }).expect(403);
    await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/transition`).set("Cookie", admin)
      .send({ action: "OPEN_QC" }).expect(404);
    await request(app).post(`/v1/admin/supplier-jobs/${jobCode}/complete`).set("Cookie", admin)
      .expect(404);
  });
});
