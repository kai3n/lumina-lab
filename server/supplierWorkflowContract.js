const CONTRACT = {
  ASSIGNED: { owner: "VENDOR", action: "ACCEPT_ORDER", stage: "OPS_REVIEW", phase: "DEFINE", waitingOn: "EXTERNAL" },
  CANDIDATES_REQUIRED: { owner: "VENDOR", action: "SUBMIT_STONE", stage: "STONE_SELECTION", phase: "DEFINE", waitingOn: "EXTERNAL" },
  CANDIDATES_REVIEW: { owner: "OPERATIONS", action: "REVIEW_STONE", stage: "STONE_SELECTION", phase: "DEFINE", waitingOn: "BELOVEDIAMOND" },
  CANDIDATES_CHANGES: { owner: "VENDOR", action: "RESUBMIT_STONE", stage: "STONE_SELECTION", phase: "DEFINE", waitingOn: "EXTERNAL" },
  CUSTOMER_STONE_SELECTION: { owner: "CUSTOMER", action: "SELECT_STONE", stage: "STONE_SELECTION", phase: "DEFINE", waitingOn: "CUSTOMER" },
  DIAMOND_LOCKED: { owner: "OPERATIONS", action: "OPEN_ESTIMATE", stage: "STONE_SELECTION", phase: "DEFINE", waitingOn: "BELOVEDIAMOND" },
  ESTIMATE_REQUIRED: { owner: "VENDOR", action: "SUBMIT_ESTIMATE", stage: "QUOTE", phase: "DEFINE", waitingOn: "EXTERNAL" },
  ESTIMATE_REVIEW: { owner: "OPERATIONS", action: "REVIEW_ESTIMATE", stage: "QUOTE", phase: "DEFINE", waitingOn: "BELOVEDIAMOND" },
  ESTIMATE_CHANGES: { owner: "VENDOR", action: "RESUBMIT_ESTIMATE", stage: "QUOTE", phase: "DEFINE", waitingOn: "EXTERNAL" },
  ESTIMATE_APPROVED: { owner: "OPERATIONS", action: "SEND_QUOTE", stage: "QUOTE", phase: "DEFINE", waitingOn: "BELOVEDIAMOND" },
  QUOTE_CUSTOMER_REVIEW: { owner: "CUSTOMER", action: "REVIEW_QUOTE", stage: "QUOTE", phase: "DEFINE", waitingOn: "CUSTOMER" },
  DEPOSIT_REQUIRED: { owner: "CUSTOMER", action: "PAY_DEPOSIT", stage: "DEPOSIT", phase: "DEFINE", waitingOn: "CUSTOMER" },
  DESIGN_REQUIRED: { owner: "VENDOR", action: "SUBMIT_CAD", stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "EXTERNAL" },
  DESIGN_REVIEW: { owner: "OPERATIONS", action: "REVIEW_CAD", stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "BELOVEDIAMOND" },
  DESIGN_CHANGES: { owner: "VENDOR", action: "RESUBMIT_CAD", stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "EXTERNAL" },
  CUSTOMER_CAD_REVIEW: { owner: "CUSTOMER", action: "REVIEW_CAD", stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "CUSTOMER" },
  DESIGN_APPROVED: { owner: "VENDOR", action: "START_PRODUCTION", stage: "CAD", phase: "APPROVE_DESIGN", waitingOn: "EXTERNAL" },
  IN_PRODUCTION: { owner: "VENDOR", action: "PRODUCTION_PROGRESS", stage: "PRODUCTION", phase: "MAKING", waitingOn: "EXTERNAL" },
  PROGRESS_REVIEW: { owner: "OPERATIONS", action: "REVIEW_PROGRESS", stage: "PRODUCTION", phase: "MAKING", waitingOn: "BELOVEDIAMOND" },
  PROGRESS_CHANGES: { owner: "VENDOR", action: "RESUBMIT_PROGRESS", stage: "PRODUCTION", phase: "MAKING", waitingOn: "EXTERNAL" },
  QC_REQUIRED: { owner: "VENDOR", action: "SUBMIT_QC", stage: "FINAL_QC", phase: "MAKING", waitingOn: "EXTERNAL" },
  QC_REVIEW: { owner: "OPERATIONS", action: "REVIEW_QC", stage: "FINAL_QC", phase: "MAKING", waitingOn: "BELOVEDIAMOND" },
  QC_CHANGES: { owner: "VENDOR", action: "RESUBMIT_QC", stage: "FINAL_QC", phase: "MAKING", waitingOn: "EXTERNAL" },
  CUSTOMER_QC_REVIEW: { owner: "OPERATIONS", action: "RECORD_QC_DECISION", stage: "FINAL_QC", phase: "MAKING", waitingOn: "BELOVEDIAMOND" },
  QC_APPROVED: { owner: "VENDOR", action: "SUBMIT_SHIPPING", stage: "FINAL_QC", phase: "MAKING", waitingOn: "EXTERNAL" },
  HANDOFF_READY: { owner: "OPERATIONS", action: "CONFIRM_RECEIPT", stage: "FINAL_QC", phase: "MAKING", waitingOn: "BELOVEDIAMOND" },
  // Supplier completion means BeloveD received the workshop handoff. It does
  // not mean the customer order has been shipped or delivered, so stage/phase
  // remain owned by the customer-order workflow.
  COMPLETED: { owner: "NONE", action: "COMPLETED", stage: null, phase: null, waitingOn: "BELOVEDIAMOND" },
};

export const SUPPLIER_WORKFLOW_CONTRACT = Object.freeze(CONTRACT);
export const SUPPLIER_WORKFLOW_STATES = Object.freeze(Object.keys(CONTRACT));

export function supplierOperationalState(workflowState) {
  const state = CONTRACT[workflowState];
  if (!state) return { owner: "OPERATIONS", action: "CHECK_ORDER", needsReview: false };
  return {
    owner: state.owner,
    action: state.action,
    needsReview: state.owner === "OPERATIONS" && state.action.startsWith("REVIEW_"),
  };
}

export function supplierOrderProjection(workflowState) {
  const state = CONTRACT[workflowState];
  if (!state) throw new Error(`Unknown supplier workflow state: ${workflowState}`);
  return { stage: state.stage, phase: state.phase, waitingOn: state.waitingOn };
}

export async function syncCustomerOrderToSupplierWorkflow(client, orderId, workflowState) {
  const projection = supplierOrderProjection(workflowState);
  const current = (await client.query(
    "select stage, phase, waiting_on from customer_orders where id=$1 for update",
    [orderId],
  )).rows[0];
  if (!current) throw new Error(`Customer order ${orderId} not found while syncing supplier workflow`);

  // Never let a late supplier action reopen a terminal customer order.
  if (new Set(["DELIVERED", "CANCELLED"]).has(current.stage)) {
    await client.query("update customer_orders set updated_at=now() where id=$1", [orderId]);
    return { stage: current.stage, phase: current.phase, waitingOn: current.waiting_on };
  }

  const stage = projection.stage || current.stage;
  const phase = projection.phase || current.phase;
  await client.query(
    `update customer_orders
     set stage=$2, phase=$3, waiting_on=$4, updated_at=now()
     where id=$1`,
    [orderId, stage, phase, projection.waitingOn],
  );
  return { stage, phase, waitingOn: projection.waitingOn };
}
