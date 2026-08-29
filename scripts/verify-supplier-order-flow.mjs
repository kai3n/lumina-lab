import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { closePool, query } from "../server/db.js";
import { getAdminOrder } from "../server/adminRepository.js";
import {
  createDraftIntake,
  getCustomerOrder,
  respondToAction,
  submitIntake,
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
  await transitionSupplierJobByAdmin(assignment.jobCode, "PREPARE_QUOTE", {}, null);
  await transitionSupplierJobByAdmin(assignment.jobCode, "CUSTOMER_ACCEPT_QUOTE", {}, null);
  await transitionSupplierJobByAdmin(assignment.jobCode, "CONFIRM_DEPOSIT", {}, null);

  const cad = await addSupplierUpdate(supplier.id, assignment.jobCode, {
    type: "CAD",
    note: "Scoped CAD V1",
    media: [{ name: "cad.jpg", type: "image/jpeg", url: "https://media.example/cad.jpg" }],
  });
  refs.add(String(cad.id));
  const cadReview = await reviewSupplierUpdate(cad.id, "approved", null, null);
  assert.equal(cadReview.workflowState, "CUSTOMER_CAD_REVIEW");
  const customerCad = await getCustomerOrder(order.orderCode, customerEmail);
  assert.equal(customerCad.nextAction?.kind, "CAD_REVIEW");
  assert.equal(customerCad.publishedArtifacts[0]?.type, "CAD");
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

  const qc = await addSupplierUpdate(supplier.id, assignment.jobCode, {
    type: "QC",
    note: "Scoped final QC",
    media: [{ name: "qc.mp4", type: "video/mp4", url: "https://media.example/qc.mp4" }],
  });
  refs.add(String(qc.id));
  const qcReview = await reviewSupplierUpdate(qc.id, "approved", null, null);
  assert.equal(qcReview.workflowState, "CUSTOMER_QC_REVIEW");
  assert.equal((await respondToAction(qcReview.customerActionCode, customerEmail, { response: "CONFIRM" })).supplierWorkflowState, "QC_APPROVED");
  assert.equal((await transitionSupplierWorkflow(supplier.id, assignment.jobCode, "CONFIRM_HANDOFF")).workflowState, "HANDOFF_READY");
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
