-- Keep internal QC approval separate from the customer's final confirmation.
alter table supplier_order_assignments
  drop constraint if exists supplier_order_assignments_workflow_state_check;

alter table supplier_order_assignments
  add constraint supplier_order_assignments_workflow_state_check
  check (workflow_state in (
    'ASSIGNED', 'CANDIDATES_REQUIRED', 'CANDIDATES_REVIEW', 'CANDIDATES_CHANGES',
    'CUSTOMER_STONE_SELECTION', 'DIAMOND_LOCKED',
    'ESTIMATE_REQUIRED', 'ESTIMATE_REVIEW', 'ESTIMATE_CHANGES', 'ESTIMATE_APPROVED',
    'QUOTE_CUSTOMER_REVIEW', 'DEPOSIT_REQUIRED',
    'DESIGN_REQUIRED', 'DESIGN_REVIEW', 'DESIGN_CHANGES', 'CUSTOMER_CAD_REVIEW', 'DESIGN_APPROVED',
    'IN_PRODUCTION', 'PROGRESS_REVIEW', 'PROGRESS_CHANGES', 'QC_REQUIRED', 'QC_REVIEW',
    'QC_CHANGES', 'CUSTOMER_QC_REVIEW', 'QC_APPROVED', 'HANDOFF_READY', 'COMPLETED'
  ));
