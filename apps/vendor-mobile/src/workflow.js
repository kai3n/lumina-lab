export const TASKS = {
  STONE: {
    label: "订单专属候选钻批次",
    action: "提交候选钻批次",
    requirements: ["Solitaire 建议提交 10–20 颗候选", "填写 IGI 号、批次有效期与临时保留期", "上传证书、正面实拍和视频"],
  },
  ESTIMATE: {
    label: "供应商成本报价",
    action: "提交重量与工费报价",
    requirements: ["预计净金重与损耗", "工费、配石/材料费与币种", "生产周期、估算假设与报价证据"],
  },
  CAD: {
    label: "CAD / 设计方案",
    action: "上传设计文件",
    requirements: ["正面、侧面与背面视图", "标注关键尺寸", "说明本版本修改内容"],
  },
  PROGRESS: {
    label: "制作进度",
    action: "上传制作进度",
    requirements: ["清晰展示当前完成状态", "说明已完成与下一步", "如有延期风险请在说明中写明"],
  },
  QC: {
    label: "成品终检",
    action: "上传终检证据",
    requirements: ["正面、侧面、背面照片或视频", "刻字、爪位、连接点等细节", "证书/腰码与实际重量凭证"],
  },
  SHIPPING: {
    label: "寄件与物流凭证",
    action: "填写物流并确认寄出",
    requirements: ["填写寄往 BeloveD 的物流单号", "上传至少一张寄件面单或收据照片", "确认包装完成后再提交"],
  },
};

const STATES = {
  ASSIGNED: { stageKey: "new", stage: "待接单", progress: 4, waiting: "请确认接单与承诺交期", vendorAction: "ACCEPT", vendorLabel: "接受任务" },
  CANDIDATES_REQUIRED: { stageKey: "new", stage: "待提交候选钻", progress: 9, waiting: "请提交本订单专属候选钻批次", taskType: "STONE" },
  CANDIDATES_REVIEW: { stageKey: "review", stage: "候选钻审核中", progress: 14, waiting: "候选钻已提交，等待 Operations 审核", reviewType: "STONE" },
  CANDIDATES_CHANGES: { stageKey: "new", stage: "候选钻需补充", progress: 11, waiting: "请按审核意见更新候选钻批次", taskType: "STONE", changes: true },
  CUSTOMER_STONE_SELECTION: { stageKey: "review", stage: "等待客户选钻", progress: 18, waiting: "候选钻已通过，等待客户选择" },
  DIAMOND_LOCKED: { stageKey: "review", stage: "钻石已锁定", progress: 23, waiting: "选中钻石已锁定，等待开放供应报价任务" },
  ESTIMATE_REQUIRED: { stageKey: "new", stage: "待提交供应报价", progress: 27, waiting: "请提交金重、工费、材料费和交期", taskType: "ESTIMATE" },
  ESTIMATE_REVIEW: { stageKey: "review", stage: "供应报价审核中", progress: 32, waiting: "供应报价已提交，等待 Operations 审核", reviewType: "ESTIMATE" },
  ESTIMATE_CHANGES: { stageKey: "new", stage: "供应报价需修改", progress: 29, waiting: "请按审核意见提交新的供应报价", taskType: "ESTIMATE", changes: true },
  ESTIMATE_APPROVED: { stageKey: "review", stage: "供应报价已确认", progress: 36, waiting: "等待 Operations 生成客户报价" },
  QUOTE_CUSTOMER_REVIEW: { stageKey: "review", stage: "等待客户确认报价", progress: 40, waiting: "客户报价与条款已发出，等待客户确认" },
  DEPOSIT_REQUIRED: { stageKey: "review", stage: "等待定金", progress: 44, waiting: "客户已接受报价，等待定金到账" },
  DESIGN_REQUIRED: { stageKey: "review", stage: "待上传设计", progress: 48, waiting: "定金已确认，请上传第一版 CAD", taskType: "CAD" },
  DESIGN_REVIEW: { stageKey: "review", stage: "内部设计审核中", progress: 53, waiting: "设计已提交，等待 Operations 内部审核", reviewType: "CAD" },
  DESIGN_CHANGES: { stageKey: "review", stage: "设计需修改", progress: 50, waiting: "请根据审核意见上传新的设计版本", taskType: "CAD", changes: true },
  CUSTOMER_CAD_REVIEW: { stageKey: "review", stage: "等待客户确认 CAD", progress: 57, waiting: "内部审核已通过，等待客户确认 CAD" },
  DESIGN_APPROVED: { stageKey: "review", stage: "CAD 已批准", progress: 61, waiting: "请确认最终 CAD 并开始制作", vendorAction: "CONFIRM_PRODUCTION", vendorLabel: "确认并开始制作" },
  IN_PRODUCTION: { stageKey: "production", stage: "制作中", progress: 68, waiting: "请上传本阶段制作进度", taskType: "PROGRESS" },
  PROGRESS_REVIEW: { stageKey: "review", stage: "进度审核中", progress: 72, waiting: "制作进度已提交，等待 Operations 审核", reviewType: "PROGRESS" },
  PROGRESS_CHANGES: { stageKey: "production", stage: "进度需补充", progress: 70, waiting: "请根据审核意见补充制作进度", taskType: "PROGRESS", changes: true },
  QC_REQUIRED: { stageKey: "qc", stage: "待终检", progress: 80, waiting: "请上传成品终检证据", taskType: "QC" },
  QC_REVIEW: { stageKey: "qc", stage: "终检审核中", progress: 87, waiting: "终检资料已提交，等待 Operations 审核", reviewType: "QC" },
  QC_CHANGES: { stageKey: "qc", stage: "终检需修改", progress: 84, waiting: "请根据审核意见补充终检资料", taskType: "QC", changes: true },
  CUSTOMER_QC_REVIEW: { stageKey: "qc", stage: "等待客户确认成品", progress: 91, waiting: "终检已通过并发送客户，等待客户确认" },
  QC_APPROVED: { stageKey: "production", stage: "待寄出", progress: 93, waiting: "请填写物流单号并上传寄件凭证", taskType: "SHIPPING" },
  HANDOFF_READY: { stageKey: "production", stage: "供应商已寄出", progress: 97, waiting: "包裹已寄出，等待 Operations 确认收货" },
  COMPLETED: { stageKey: "done", stage: "已完成", progress: 100, waiting: "订单履约已完成" },
};

export const WORKFLOW_STATES = Object.freeze(Object.keys(STATES));

const TRANSITIONS = {
  CANDIDATES_REQUIRED: { SUBMIT_STONE: "CANDIDATES_REVIEW" },
  CANDIDATES_REVIEW: { APPROVE: "CUSTOMER_STONE_SELECTION", REQUEST_CHANGES: "CANDIDATES_CHANGES" },
  CANDIDATES_CHANGES: { SUBMIT_STONE: "CANDIDATES_REVIEW" },
  CUSTOMER_STONE_SELECTION: { LOCK_DIAMOND: "DIAMOND_LOCKED" },
  DIAMOND_LOCKED: { OPEN_ESTIMATE: "ESTIMATE_REQUIRED" },
  ESTIMATE_REQUIRED: { SUBMIT_ESTIMATE: "ESTIMATE_REVIEW" },
  ESTIMATE_REVIEW: { APPROVE: "ESTIMATE_APPROVED", REQUEST_CHANGES: "ESTIMATE_CHANGES" },
  ESTIMATE_CHANGES: { SUBMIT_ESTIMATE: "ESTIMATE_REVIEW" },
  ESTIMATE_APPROVED: { PREPARE_QUOTE: "QUOTE_CUSTOMER_REVIEW" },
  QUOTE_CUSTOMER_REVIEW: { CUSTOMER_ACCEPT_QUOTE: "DEPOSIT_REQUIRED" },
  DEPOSIT_REQUIRED: { CONFIRM_DEPOSIT: "DESIGN_REQUIRED" },
  DESIGN_REQUIRED: { SUBMIT_CAD: "DESIGN_REVIEW" },
  DESIGN_REVIEW: { APPROVE: "CUSTOMER_CAD_REVIEW", REQUEST_CHANGES: "DESIGN_CHANGES" },
  DESIGN_CHANGES: { SUBMIT_CAD: "DESIGN_REVIEW" },
  CUSTOMER_CAD_REVIEW: { APPROVE: "DESIGN_APPROVED", REQUEST_CHANGES: "DESIGN_CHANGES" },
  DESIGN_APPROVED: { CONFIRM_PRODUCTION: "IN_PRODUCTION" },
  IN_PRODUCTION: { SUBMIT_PROGRESS: "PROGRESS_REVIEW", OPEN_QC: "QC_REQUIRED" },
  PROGRESS_REVIEW: { APPROVE: "IN_PRODUCTION", REQUEST_CHANGES: "PROGRESS_CHANGES" },
  PROGRESS_CHANGES: { SUBMIT_PROGRESS: "PROGRESS_REVIEW" },
  QC_REQUIRED: { SUBMIT_QC: "QC_REVIEW" },
  QC_REVIEW: { APPROVE: "CUSTOMER_QC_REVIEW", REQUEST_CHANGES: "QC_CHANGES" },
  QC_CHANGES: { SUBMIT_QC: "QC_REVIEW" },
  CUSTOMER_QC_REVIEW: { CUSTOMER_CONFIRM_QC: "QC_APPROVED", REQUEST_CHANGES: "QC_CHANGES" },
  QC_APPROVED: { SUBMIT_SHIPPING: "HANDOFF_READY" },
  HANDOFF_READY: { COMPLETE: "COMPLETED" },
};

export function fallbackWorkflowState(orderStage, acceptedAt) {
  if (!acceptedAt) return "ASSIGNED";
  if (orderStage === "CAD") return "DESIGN_REQUIRED";
  if (orderStage === "PRODUCTION") return "IN_PRODUCTION";
  if (orderStage === "FINAL_QC") return "QC_REQUIRED";
  if (["SHIPPING", "BALANCE"].includes(orderStage)) return "HANDOFF_READY";
  if (["DELIVERED", "CANCELLED"].includes(orderStage)) return "COMPLETED";
  return "ESTIMATE_REQUIRED";
}

export function workflowView(state, updates = []) {
  const workflowState = STATES[state] ? state : "ASSIGNED";
  const config = STATES[workflowState];
  const task = config.taskType ? TASKS[config.taskType] : null;
  const current = [...updates].find((item) => item.type === (config.taskType || config.reviewType) && item.status !== "superseded");
  return {
    workflowState,
    ...config,
    task: task ? {
      ...task,
      type: config.taskType,
      current,
      state: config.changes ? "changes" : "action",
      statusLabel: config.changes ? "需要修改" : "等待提交",
    } : current ? {
      ...TASKS[config.reviewType],
      type: config.reviewType,
      current,
      state: "submitted",
      statusLabel: "等待 Operations 审核",
    } : null,
  };
}

export function transitionWorkflow(state, event, { productLine = "solitaire" } = {}) {
  if (state === "ASSIGNED" && event === "ACCEPT") return productLine === "multi" ? "ESTIMATE_REQUIRED" : "CANDIDATES_REQUIRED";
  const next = TRANSITIONS[state]?.[event];
  if (!next) throw new Error(`Invalid vendor workflow transition: ${state} -> ${event}`);
  return next;
}

export function eventForUpdate(type) {
  const value = String(type || "").toUpperCase();
  if (["STONE", "ESTIMATE", "CAD", "PROGRESS", "QC", "SHIPPING"].includes(value)) return `SUBMIT_${value}`;
  return null;
}

export function operationsActions(state) {
  if (["CANDIDATES_REVIEW", "ESTIMATE_REVIEW", "DESIGN_REVIEW", "PROGRESS_REVIEW", "QC_REVIEW"].includes(state)) {
    const approveLabels = {
      CANDIDATES_REVIEW: "批准并发布候选",
      ESTIMATE_REVIEW: "确认供应报价",
      DESIGN_REVIEW: "内部通过并发送客户",
      PROGRESS_REVIEW: "确认制作进度",
      QC_REVIEW: "批准终检并发送客户",
    };
    return [
      { event: "REQUEST_CHANGES", label: "退回修改", tone: "secondary" },
      { event: "APPROVE", label: approveLabels[state], tone: "primary" },
    ];
  }
  if (state === "CUSTOMER_STONE_SELECTION") return [{ event: "LOCK_DIAMOND", label: "记录客户选择并锁钻", tone: "primary" }];
  if (state === "DIAMOND_LOCKED") return [{ event: "OPEN_ESTIMATE", label: "开放供应报价任务", tone: "primary" }];
  if (state === "ESTIMATE_APPROVED") return [{ event: "PREPARE_QUOTE", label: "生成并发送客户报价", tone: "primary" }];
  if (state === "QUOTE_CUSTOMER_REVIEW") return [{ event: "CUSTOMER_ACCEPT_QUOTE", label: "记录客户已接受报价", tone: "primary" }];
  if (state === "DEPOSIT_REQUIRED") return [{ event: "CONFIRM_DEPOSIT", label: "确认定金到账并开放 CAD", tone: "primary" }];
  if (state === "CUSTOMER_CAD_REVIEW") return [
    { event: "REQUEST_CHANGES", label: "客户要求修改", tone: "secondary" },
    { event: "APPROVE", label: "记录客户批准 CAD", tone: "primary" },
  ];
  if (state === "IN_PRODUCTION") return [{ event: "OPEN_QC", label: "制作完成，开放成品终检", tone: "primary" }];
  if (state === "CUSTOMER_QC_REVIEW") return [
    { event: "REQUEST_CHANGES", label: "客户要求修改", tone: "secondary" },
    { event: "CUSTOMER_CONFIRM_QC", label: "记录客户确认成品", tone: "primary" },
  ];
  if (state === "HANDOFF_READY") return [{ event: "COMPLETE", label: "确认收货并完成", tone: "primary" }];
  return [];
}

const TIMELINE_INDEX = {
  ASSIGNED: 0,
  CANDIDATES_REQUIRED: 1, CANDIDATES_REVIEW: 1, CANDIDATES_CHANGES: 1,
  CUSTOMER_STONE_SELECTION: 2,
  DIAMOND_LOCKED: 3,
  ESTIMATE_REQUIRED: 4, ESTIMATE_REVIEW: 4, ESTIMATE_CHANGES: 4,
  ESTIMATE_APPROVED: 5,
  QUOTE_CUSTOMER_REVIEW: 6,
  DEPOSIT_REQUIRED: 7,
  DESIGN_REQUIRED: 8,
  DESIGN_REVIEW: 9, DESIGN_CHANGES: 8,
  CUSTOMER_CAD_REVIEW: 10,
  DESIGN_APPROVED: 11,
  IN_PRODUCTION: 12,
  PROGRESS_REVIEW: 13, PROGRESS_CHANGES: 13,
  QC_REQUIRED: 14, QC_REVIEW: 14, QC_CHANGES: 14,
  CUSTOMER_QC_REVIEW: 14,
  QC_APPROVED: 15,
  HANDOFF_READY: 16,
  COMPLETED: 17,
};

const TIMELINE = [
  "供货商确认接单",
  "提交订单专属候选钻",
  "客户选择钻石",
  "Diamond Locked",
  "提交重量 / 工费 / 材料 / 交期报价",
  "Operations 确认供应报价",
  "客户报价与条款确认",
  "定金到账",
  "上传 CAD",
  "Operations 内部审核 CAD",
  "客户确认 CAD",
  "供货商确认开工",
  "开始制作",
  "提交制作进度",
  "成品终检",
  "供货商已寄出包裹",
  "Operations 确认收货",
  "订单履约完成",
];

export function workflowTimeline(state, { productLine = "solitaire" } = {}) {
  const currentIndex = TIMELINE_INDEX[state] ?? 0;
  const isComplete = state === "COMPLETED";
  return TIMELINE.map((title, index) => {
    const skipped = productLine === "multi" && index >= 1 && index <= 3 && currentIndex > 0;
    return {
      title,
      meta: skipped ? "多石订单不适用" : index < currentIndex || isComplete ? "已完成" : index === currentIndex ? STATES[state]?.waiting || "进行中" : "待开始",
      done: skipped || index < currentIndex || isComplete,
      current: !skipped && !isComplete && index === currentIndex,
      skipped,
    };
  });
}

export const WORKFLOW_SEQUENCE = [
  "ASSIGNED", "CANDIDATES_REQUIRED", "CANDIDATES_REVIEW", "CUSTOMER_STONE_SELECTION", "DIAMOND_LOCKED",
  "ESTIMATE_REQUIRED", "ESTIMATE_REVIEW", "ESTIMATE_APPROVED", "QUOTE_CUSTOMER_REVIEW", "DEPOSIT_REQUIRED",
  "DESIGN_REQUIRED", "DESIGN_REVIEW", "CUSTOMER_CAD_REVIEW", "DESIGN_APPROVED", "IN_PRODUCTION",
  "QC_REQUIRED", "QC_REVIEW", "CUSTOMER_QC_REVIEW", "QC_APPROVED", "HANDOFF_READY", "COMPLETED",
];
