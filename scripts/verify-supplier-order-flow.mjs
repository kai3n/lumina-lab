import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { closePool, query } from "../server/db.js";
import { getAdminOrder } from "../server/adminRepository.js";
import {
  createDraftIntake,
  recordOrderEvent,
  reportOrderPayment,
  respondToAction,
  submitIntake,
  updateOrderShippingAddress,
} from "../server/customerRepository.js";
import {
  addSupplierUpdate,
  assignSupplierOrder,
  completeSupplierJob,
  createSupplier,
  getAdminSupplierOrderContext,
  getSupplierOrder,
  reviewSupplierUpdate,
  transitionSupplierJobByAdmin,
  transitionSupplierWorkflow,
  updateSupplierStatus,
} from "../server/supplierRepository.js";

if (process.env.ALLOW_SCOPED_E2E !== "1") {
  throw new Error("Set ALLOW_SCOPED_E2E=1 to run the self-cleaning scoped verification");
}

const token = randomBytes(6).toString("hex");
const customerEmail = `codex-order-e2e-${token}@belovediamond.test`;
const supplierEmail = `codex-vendor-e2e-${token}@belovediamond.test`;
const refs = new Set();
let supplierId = null;

async function verifiedMediaFixture(ownerSupplierId, jobCode, purpose, fileName, mimeType = "image/jpeg") {
  const assignment = (await query(`
    select id, order_id from supplier_order_assignments
    where supplier_id=$1 and job_code=$2 and status='active'
  `, [ownerSupplierId, jobCode])).rows[0];
  assert.ok(assignment, `active assignment required for ${purpose} media`);
  const sequence = (await query("select nextval('media_code_seq') as n")).rows[0].n;
  const mediaCode = `MED-${String(sequence).padStart(6, "0")}`;
  const ext = mimeType === "video/mp4" ? "mp4" : "jpg";
  const scope = new Set(["QC", "SHIPPING"]).has(purpose) ? "qc" : purpose === "CAD" ? "cad" : "proposal";
  const storageKey = `vendor/${ownerSupplierId}/${jobCode.toLowerCase()}/${scope}/${new Date().toISOString().slice(0, 10)}/${randomBytes(12).toString("hex")}.${ext}`;
  await query(`
    insert into media_assets
      (media_code, owner_supplier_id, order_id, supplier_assignment_id, status,
       kind, mime_type, byte_size, storage_key, provider, purpose, verified_at, public_payload)
    values ($1,$2,$3,$4,'READY',$5,$6,1,$7,'local',$8,now(),$9)
  `, [mediaCode, ownerSupplierId, assignment.order_id, assignment.id,
    mimeType.startsWith("video/") ? "video" : "image", mimeType, storageKey, purpose,
    { fileName, localUrl: `https://media.invalid/${token}/${encodeURIComponent(fileName)}` }]);
  refs.add(mediaCode);
  return { assetId: mediaCode };
}

async function cleanup() {
  await query("delete from customer_orders where customer_id in (select id from customers where email=$1)", [customerEmail]);
  await query("delete from customer_intakes where contact_email=$1", [customerEmail]);
  await query("delete from customers where email=$1", [customerEmail]);
  await query("delete from suppliers where email=$1", [supplierEmail]);
  if (supplierId) await query("delete from audit_log where actor_type='supplier' and actor_ref=$1", [String(supplierId)]);
  if (refs.size) await query("delete from audit_log where entity_ref=any($1::text[])", [[...refs]]);
}

try {
  const draft = await createDraftIntake({
    email: customerEmail,
    name: "Scoped Order E2E",
    locale: "en",
    category: "ring",
    productLine: "solitaire",
    conditional: { ringSize: "6" },
  });
  const order = await submitIntake(draft.intakeId);
  refs.add(order.orderCode);

  const supplier = await createSupplier({
    email: supplierEmail,
    displayName: "Scoped Vendor E2E",
    contactName: "Scoped Vendor E2E",
    locale: "zh",
  }, null);
  supplierId = supplier.id;
  refs.add(supplier.supplierCode);
  await updateSupplierStatus(supplier.supplierCode, "active", null);
  const assignment = await assignSupplierOrder({
    orderCode: order.orderCode,
    supplierCode: supplier.supplierCode,
  }, null);
  refs.add(assignment.jobCode);
  assert.equal(assignment.jobCode, order.orderCode.replace(/^BD-/, "JOB-"));
  assert.deepEqual(
    (({ stage, waitingOn }) => ({ stage, waitingOn }))(await getAdminOrder(order.orderCode)),
    { stage: "OPS_REVIEW", waitingOn: "EXTERNAL" },
  );

  assert.equal((await transitionSupplierWorkflow(supplier.id, assignment.jobCode, "ACCEPT")).workflowState, "CANDIDATES_REQUIRED");
  const stone = await addSupplierUpdate(supplier.id, assignment.jobCode, {
    type: "STONE",
    data: {
      candidateCount: 1,
      batchValidUntil: "2026-08-15",
      igiNumbers: "IGI-SCOPED-E2E",
      availabilityConfirmed: true,
    },
  });
  refs.add(String(stone.id));
  assert.equal((await getAdminOrder(order.orderCode)).waitingOn, "BELOVEDIAMOND");
  assert.equal((await reviewSupplierUpdate(stone.id, "approved", null, null)).workflowState, "CUSTOMER_STONE_SELECTION");
  await transitionSupplierJobByAdmin(assignment.jobCode, "LOCK_DIAMOND", { lockedDiamondRef: "IGI-SCOPED-E2E" }, null);
  await transitionSupplierJobByAdmin(assignment.jobCode, "OPEN_ESTIMATE", {}, null);

  const estimate = await addSupplierUpdate(supplier.id, assignment.jobCode, {
    type: "ESTIMATE",
    data: {
      netWeightG: 4.8,
      lossPct: 6,
      laborCost: 1200,
      materialCost: 300,
      leadTimeDays: 18,
      currency: "CNY",
      assumptions: "Scoped E2E estimate",
    },
  });
  refs.add(String(estimate.id));
  await reviewSupplierUpdate(estimate.id, "approved", null, null);

  const proposal = await recordOrderEvent(order.orderCode, "proposal_sent", {}, {
    artifact: { type: "QUOTE", payload: { totalUsd: 2_000, depositUsd: 600 } },
    action: { kind: "QUOTE_ACCEPTANCE", allowedResponses: ["APPROVE", "REQUEST_CHANGES"] },
  });
  assert.equal((await getAdminSupplierOrderContext(order.orderCode)).workflowState, "QUOTE_CUSTOMER_REVIEW");
  assert.equal((await respondToAction(proposal.actionCode, customerEmail, { response: "APPROVE" })).supplierWorkflowState, "DEPOSIT_REQUIRED");
  await updateOrderShippingAddress(order.orderCode, customerEmail, {
    recipientName: "Scoped Order E2E",
    phone: "+1 213 555 0199",
    addressLine1: "550 S Hill St",
    addressLine2: "",
    city: "Los Angeles",
    region: "CA",
    postalCode: "90013",
    country: "US",
    notes: "",
  });
  await reportOrderPayment(order.orderCode, customerEmail, "deposit");
  await recordOrderEvent(order.orderCode, "deposit_confirmed");
  assert.equal((await getAdminSupplierOrderContext(order.orderCode)).workflowState, "DESIGN_REQUIRED");

  const cadMedia = await verifiedMediaFixture(supplier.id, assignment.jobCode, "CAD", "cad.jpg");
  const cad = await addSupplierUpdate(supplier.id, assignment.jobCode, {
    type: "CAD",
    note: "Scoped CAD V1",
    media: [cadMedia],
  });
  refs.add(String(cad.id));
  const cadReview = await reviewSupplierUpdate(cad.id, "approved", null, null);
  assert.equal(cadReview.workflowState, "CUSTOMER_CAD_REVIEW");
  assert.equal((await query(`
    select kind from customer_actions where action_code=$1
  `, [cadReview.customerActionCode])).rows[0]?.kind, "CAD_REVIEW");
  assert.equal((await query(`
    select type from published_artifacts where order_id=(select id from customer_orders where order_code=$1)
    order by published_at desc, id desc limit 1
  `, [order.orderCode])).rows[0]?.type, "CAD");
  assert.equal((await respondToAction(cadReview.customerActionCode, customerEmail, { response: "APPROVE" })).supplierWorkflowState, "DESIGN_APPROVED");

  assert.equal((await transitionSupplierWorkflow(supplier.id, assignment.jobCode, "CONFIRM_PRODUCTION")).workflowState, "IN_PRODUCTION");
  const progress1 = await addSupplierUpdate(supplier.id, assignment.jobCode, { type: "PROGRESS", note: "Setting complete" });
  assert.equal(progress1.status, "submitted");
  assert.equal((await getAdminSupplierOrderContext(order.orderCode)).pendingReviewCount, 1);
  assert.equal((await reviewSupplierUpdate(progress1.id, "approved", null, null)).workflowState, "IN_PRODUCTION");
  const progress2 = await addSupplierUpdate(supplier.id, assignment.jobCode, { type: "PROGRESS", note: "Polishing complete" });
  refs.add(String(progress1.id)); refs.add(String(progress2.id));
  assert.deepEqual([progress1.version, progress2.version], [1, 2]);
  assert.deepEqual([progress1.status, progress2.status], ["submitted", "submitted"]);
  const productionContext = await getAdminSupplierOrderContext(order.orderCode);
  assert.equal(productionContext.workflowState, "PROGRESS_REVIEW");
  assert.equal(productionContext.pendingReviewCount, 1);
  assert.equal((await reviewSupplierUpdate(progress2.id, "approved", null, null)).workflowState, "IN_PRODUCTION");
  await transitionSupplierJobByAdmin(assignment.jobCode, "OPEN_QC", {}, null);

  const qcMedia = await verifiedMediaFixture(supplier.id, assignment.jobCode, "QC", "qc.mp4", "video/mp4");
  const qc = await addSupplierUpdate(supplier.id, assignment.jobCode, {
    type: "QC",
    note: "Scoped final QC",
    media: [qcMedia],
  });
  refs.add(String(qc.id));
  const qcReview = await reviewSupplierUpdate(qc.id, "approved", null, null);
  assert.equal(qcReview.workflowState, "CUSTOMER_QC_REVIEW");
  assert.equal((await respondToAction(qcReview.customerActionCode, customerEmail, { response: "CONFIRM" })).supplierWorkflowState, "QC_APPROVED");
  const shippingMedia = await verifiedMediaFixture(supplier.id, assignment.jobCode, "SHIPPING", "shipping.jpg");
  assert.equal((await addSupplierUpdate(supplier.id, assignment.jobCode, {
    type: "SHIPPING",
    note: "Scoped handoff",
    data: { trackingNumber: `SCOPED-${token}` },
    media: [shippingMedia],
  })).status, "approved");
  assert.equal((await getAdminSupplierOrderContext(order.orderCode)).workflowState, "HANDOFF_READY");
  assert.deepEqual(
    (({ stage, waitingOn }) => ({ stage, waitingOn }))(await getAdminOrder(order.orderCode)),
    { stage: "FINAL_QC", waitingOn: "BELOVEDIAMOND" },
  );

  assert.equal((await completeSupplierJob(assignment.jobCode, null)).workflowState, "COMPLETED");
  const finalVendorOrder = await getSupplierOrder(supplier.id, assignment.jobCode);
  assert.equal(finalVendorOrder.workflowState, "COMPLETED");
  const finalAdminOrder = await getAdminOrder(order.orderCode);
  assert.equal(finalAdminOrder.stage, "FINAL_QC");
  assert.equal(finalAdminOrder.waitingOn, "BELOVEDIAMOND");
  console.log(JSON.stringify({ ok: true, orderCode: order.orderCode, jobCode: assignment.jobCode }));
} finally {
  await cleanup();
  await closePool();
}
