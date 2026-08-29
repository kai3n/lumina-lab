import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowLeft, BadgeCheck, Bell, CalendarClock, Camera, Check, ChevronDown, ChevronRight, CircleDollarSign,
  ClipboardCheck, Clock3, FileText, Gem, Home, ImagePlus, Layers3, LogOut, Menu,
  MessageCircle, MoreHorizontal, PackageCheck, Plus, Search, Send, Settings, ShieldCheck,
  RotateCcw, Sparkles, Truck, UploadCloud, UserRound, Video, X, Zap,
} from "lucide-react";
import { DEMO_MODE, uploadVendorMedia, vendorApi } from "./api.js";
import { inventory as initialInventory, orders as initialOrders } from "./mock.js";
import { LOCALES, useI18n } from "./i18n.jsx";
import { vendorBrand } from "./brand.js";
import { mergeSelectedFiles } from "./fileSelection.js";
import { eventForUpdate, fallbackWorkflowState, operationsActions, transitionWorkflow, workflowTimeline, workflowView } from "./workflow.js";

const STAGES = {
  new: { label: "待确认", tone: "amber" }, review: { label: "客户审核", tone: "blue" },
  production: { label: "制作中", tone: "green" }, qc: { label: "终检", tone: "violet" }, done: { label: "已完成", tone: "gray" },
};

const TASKS = {
  STONE: { label: "裸钻候选包", action: "提交裸钻候选", requirements: ["IGI 证书或证书正面图", "正面实拍与视频", "候选信息、成本与有效期写在说明中"] },
  ESTIMATE: { label: "重量与工费估算", action: "提交估算凭证", requirements: ["净金重与损耗假设", "工费、配石/材料费与交期", "称重图、草图或报价依据"] },
  CAD: { label: "CAD / 设计方案", action: "上传 CAD 版本", requirements: ["正面、侧面与背面视图", "标注关键尺寸", "说明本版本修改内容"] },
  PROGRESS: { label: "制作进度", action: "上传制作进度", requirements: ["清晰展示当前完成状态", "说明已完成与下一步", "如有延期风险请在说明中写明"] },
  QC: { label: "成品终检", action: "上传终检证据", requirements: ["正面、侧面、背面照片或视频", "刻字、爪位、连接点等细节", "证书/腰码与实际重量凭证"] },
  SHIPPING: { label: "寄件与物流凭证", action: "确认包裹已寄出", requirements: ["填写寄往 BeloveD 的物流单号", "上传至少一张寄件面单或收据照片", "确认包装完成后再提交"] },
};

const UPDATE_LABELS = {
  ACKNOWLEDGE: "任务已接受", NOTE: "进度说明", STONE: "裸钻候选", ESTIMATE: "重量与工费估算",
  CAD: "CAD / 设计方案", PROGRESS: "制作进度", QC: "成品终检", SHIPPING: "物流凭证", HANDOFF_READY: "已准备交付",
};

const REVIEW_LABELS = {
  submitted: "待订单团队审核", approved: "审核已通过", changes_requested: "需要修改", superseded: "历史版本",
};

const WORKFLOW_PHASES = [
  { id: "intake", label: "接单", title: "接单与选钻", from: 0, to: 4, updateTypes: ["STONE"] },
  { id: "quote", label: "报价", title: "报价与付款", from: 4, to: 8, updateTypes: ["ESTIMATE"] },
  { id: "cad", label: "CAD", title: "CAD 与开工", from: 8, to: 12, updateTypes: ["CAD"] },
  { id: "production", label: "制作", title: "制作与质检", from: 12, to: 15, updateTypes: ["PROGRESS", "QC"] },
  { id: "delivery", label: "交付", title: "包装与交付", from: 15, to: 18, updateTypes: ["SHIPPING"] },
];

function dateLabel(value) {
  if (!value) return "待确认";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function normalizedUpdate(item, index = 0) {
  return {
    id: item.id || `local-${index}`,
    type: String(item.type || "NOTE").toUpperCase(),
    note: item.note || "",
    media: Array.isArray(item.media) ? item.media : [],
    version: Number(item.version || 1),
    status: item.status || (String(item.type).toUpperCase() === "NOTE" ? "approved" : "submitted"),
    reviewNote: item.reviewNote || "",
    data: item.data && typeof item.data === "object" ? item.data : {},
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function apiOrderView(order) {
  const summary = order.summary || {};
  const measurements = summary.measurements || {};
  const updates = (Array.isArray(order.updates) ? order.updates : []).map(normalizedUpdate);
  const workflowState = order.workflowState || fallbackWorkflowState(order.stage, order.acceptedAt);
  const flow = workflowView(workflowState, updates);
  const task = flow.task;
  return {
    code: order.jobCode || order.orderCode,
    title: summary.styleCode || order.styleCode || `${order.category || summary.category || "custom"} · ${order.jobCode || "采购任务"}`,
    category: order.category || summary.category || "定制",
    productLine: order.productLine,
    stage: flow.stage,
    stageKey: flow.stageKey,
    workflowState: flow.workflowState,
    lockedDiamond: order.lockedDiamond || null,
    rawStage: order.stage,
    acceptedAt: order.acceptedAt,
    due: dateLabel(order.dueAt || order.expectedCompletionAt),
    dueTone: order.dueAt && new Date(order.dueAt) < new Date(Date.now() + 3 * 86400000) ? "urgent" : "",
    updated: dateLabel(order.updatedAt),
    unread: 0,
    customer: "匿名客户",
    amount: "",
    progress: flow.progress,
    heroTone: flow.stageKey === "new" ? "rose" : flow.stageKey === "review" ? "blue" : flow.stageKey === "qc" ? "gold" : "emerald",
    waiting: flow.waiting,
    task,
    vendorAction: flow.vendorAction,
    vendorLabel: flow.vendorLabel,
    updates,
    specs: {
      产品线: order.productLine === "solitaire" ? "单主石" : order.productLine === "multi" ? "多石款" : "待确认",
      金属: summary.metal || "待确认",
      尺寸: measurements.ringSize || measurements.size || "待确认",
      刻字: measurements.engraving || "无",
      客户要求日期: dateLabel(order.requiredDate),
    },
    referenceNotes: order.referenceMedia?.length ? `${order.referenceMedia.length} 个参考文件` : "暂无参考文件",
    referenceMedia: Array.isArray(order.referenceMedia) ? order.referenceMedia : [],
    feedback: "客户信息与联系方式已隐藏；反馈由订单团队转达。",
    steps: workflowTimeline(flow.workflowState, { productLine: order.productLine }),
  };
}

function demoOrderView(order, index) {
  const stageByKey = { new: "OPS_REVIEW", review: "CAD", production: "PRODUCTION", qc: "FINAL_QC", done: "DELIVERED" };
  const rawStage = order.rawStage || stageByKey[order.stageKey] || "OPS_REVIEW";
  const updates = (order.updates || []).map(normalizedUpdate);
  const acceptedAt = order.acceptedAt === undefined && order.stageKey !== "new" ? "2026-07-10T09:42:00.000Z" : order.acceptedAt;
  const productLine = order.productLine || (order.specs?.主石 ? "solitaire" : "multi");
  const workflowByKey = { new: "ASSIGNED", review: "DESIGN_REQUIRED", production: "IN_PRODUCTION", qc: "QC_REQUIRED", done: "COMPLETED" };
  const workflowState = order.workflowState || workflowByKey[order.stageKey] || "ASSIGNED";
  const flow = workflowView(workflowState, updates);
  return {
    ...order,
    code: `JOB-${String(100101 + index).padStart(6, "0")}`,
    rawStage,
    workflowState,
    productLine,
    acceptedAt,
    updates,
    stage: flow.stage,
    stageKey: flow.stageKey,
    task: flow.task,
    progress: flow.progress,
    waiting: flow.waiting,
    vendorAction: flow.vendorAction,
    vendorLabel: flow.vendorLabel,
    heroTone: flow.stageKey === "new" ? "rose" : flow.stageKey === "review" ? "blue" : flow.stageKey === "qc" ? "gold" : "emerald",
    steps: workflowTimeline(flow.workflowState, { productLine }),
  };
}

function rebuildDemoOrder(order, workflowState, updates, acceptedAt = order.acceptedAt) {
  const flow = workflowView(workflowState, updates);
  return {
    ...order,
    workflowState,
    acceptedAt,
    updates,
    stage: flow.stage,
    stageKey: flow.stageKey,
    task: flow.task,
    progress: flow.progress,
    waiting: flow.waiting,
    vendorAction: flow.vendorAction,
    vendorLabel: flow.vendorLabel,
    heroTone: flow.stageKey === "new" ? "rose" : flow.stageKey === "review" ? "blue" : flow.stageKey === "qc" ? "gold" : "emerald",
    updated: "刚刚",
    steps: workflowTimeline(flow.workflowState, { productLine: order.productLine }),
  };
}

function applyDemoUpdate(order, rawUpdate) {
  const update = normalizedUpdate(rawUpdate);
  const versioned = TASKS[update.type] && update.type !== "PROGRESS";
  const older = order.updates.map(item => versioned && item.type === update.type && item.status !== "superseded" ? { ...item, status: "superseded" } : item);
  const updates = [update, ...older];
  const event = update.type === "ACKNOWLEDGE" ? "ACCEPT" : eventForUpdate(update.type);
  const workflowState = event ? transitionWorkflow(order.workflowState, event, { productLine: order.productLine }) : order.workflowState;
  const acceptedAt = update.type === "ACKNOWLEDGE" ? update.createdAt : order.acceptedAt;
  return rebuildDemoOrder(order, workflowState, updates, acceptedAt);
}

function applyDemoOperation(order, event, reviewNote = "") {
  const currentType = order.workflowState.startsWith("CANDIDATES") ? "STONE"
    : order.workflowState.startsWith("ESTIMATE") ? "ESTIMATE"
      : order.workflowState.includes("DESIGN") || order.workflowState === "CUSTOMER_CAD_REVIEW" ? "CAD"
        : order.workflowState.startsWith("PROGRESS") ? "PROGRESS"
          : order.workflowState.startsWith("QC") ? "QC" : null;
  const isReview = event === "APPROVE" || event === "REQUEST_CHANGES";
  const updates = order.updates.map((item) => isReview && item.type === currentType && item.status !== "superseded"
    ? { ...item, status: event === "APPROVE" ? "approved" : "changes_requested", reviewNote }
    : item);
  const workflowState = transitionWorkflow(order.workflowState, event, { productLine: order.productLine });
  const lockedDiamond = event === "LOCK_DIAMOND"
    ? updates.find((item) => item.type === "STONE")?.data?.igiNumbers?.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)[0] || "已选钻石"
    : order.lockedDiamond;
  return { ...rebuildDemoOrder(order, workflowState, updates), lockedDiamond };
}

function apiInventoryView(stone) {
  const statuses = { available: "可用", reserved: "已预留", sold: "已售", unavailable: "不可用" };
  return {
    dbId: stone.id,
    id: stone.supplierSku,
    shape: stone.shape || "—",
    carat: stone.carat ?? "—",
    grade: [stone.color, stone.clarity].filter(Boolean).join(" · ") || "—",
    cert: stone.certificateNo || "—",
    price: stone.procurementCostUsd == null ? "—" : `$${stone.procurementCostUsd}`,
    status: statuses[stone.availability] || stone.availability,
    media: stone.media?.length || 0,
  };
}

function StatusBadge({ stageKey, children }) {
  const { t } = useI18n();
  const stage = STAGES[stageKey] || STAGES.done;
  return <span className={`status-badge ${stage.tone}`}><i />{t(children || stage.label)}</span>;
}

function Header({ title, eyebrow, onBack, action }) {
  const { t } = useI18n();
  return (
    <header className="page-header">
      <div className="header-title-row">
        {onBack && <button className="icon-button back" onClick={onBack} aria-label={t("返回")}><ArrowLeft size={21} /></button>}
        <div className="header-copy">{eyebrow && <span>{t(eyebrow)}</span>}<h1>{t(title)}</h1></div>
        {action || <span className="header-spacer" />}
      </div>
    </header>
  );
}

function BottomNav({ current, onChange, orderCount }) {
  const { t } = useI18n();
  const items = [
    ["home", Home, "工作台"], ["orders", ClipboardCheck, "订单"], ["stock", Gem, "库存"], ["me", UserRound, "我的"],
  ];
  return <nav className="bottom-nav" aria-label={t("主导航")}>{items.map(([key, Icon, label]) => (
    <button key={key} className={current === key ? "active" : ""} onClick={() => onChange(key)}>
      <span className="nav-icon"><Icon size={21} strokeWidth={current === key ? 2.5 : 2} />{key === "orders" && orderCount > 0 && <b>{Math.min(orderCount, 99)}</b>}</span><small>{t(label)}</small>
    </button>
  ))}</nav>;
}

function OrderCard({ order, onOpen, compact = false }) {
  const { t } = useI18n();
  return (
    <button className={`order-card ${compact ? "compact" : ""}`} onClick={() => onOpen(order)}>
      <div className={`order-gem ${order.heroTone}`}><Gem size={25} /><span>{t(order.category)}</span></div>
      <div className="order-body">
        <div className="order-meta"><span>{order.code}</span><span>·</span><span>{order.updated}</span></div>
        <h3>{t(order.title)}</h3>
        <div className="order-status-row"><StatusBadge stageKey={order.stageKey}>{order.stage}</StatusBadge>{order.unread > 0 && <span className="unread">{t(`${order.unread} 条新消息`)}</span>}</div>
        {!compact && <><p className="order-waiting">{t(order.waiting)}</p><div className="order-footer"><span className={order.dueTone || ""}><CalendarClock size={15} />{t(order.due)}</span><ChevronRight size={17} /></div></>}
      </div>
    </button>
  );
}

function HomePage({ orders, inventory, supplier, onOpen, onNavigate }) {
  const { t, locale } = useI18n();
  const brand = vendorBrand(locale);
  const urgent = orders[1] || orders[0];
  return <>
    <div className="brand-header">
      <div><p>{brand.name}</p><h1>{t("早上好")}，{supplier?.displayName || t("华南工坊")}</h1></div>
      <button className="avatar-button" aria-label={t("通知")}><Bell size={20} /><b>3</b></button>
    </div>
    <main className="page-content home-content">
      <section className="focus-card">
        <div className="focus-top"><span className="eyebrow"><Zap size={13} /> {t("今日优先")}</span><span>{t("7月14日 周二")}</span></div>
        <h2>{t(orders.length ? `${orders.length} 个订单` : "暂时没有待处理订单")}</h2>
        <p>{t("先确认新订单，避免影响承诺交期。")}</p>
        {urgent && <button onClick={() => onOpen(urgent)}><span><strong>{urgent.code}</strong>{t(urgent.waiting)}</span><ChevronRight size={20} /></button>}
      </section>

      <section className="metric-grid" aria-label={t("订单概览")}>
        <button onClick={() => onNavigate("orders")}><span className="metric-icon amber"><Clock3 size={19} /></span><b>{orders.filter((x) => x.stageKey === "new").length}</b><small>{t("待响应")}</small></button>
        <button onClick={() => onNavigate("orders")}><span className="metric-icon green"><Layers3 size={19} /></span><b>{orders.filter((x) => x.stageKey === "production").length}</b><small>{t("制作中")}</small></button>
        <button onClick={() => onNavigate("orders")}><span className="metric-icon violet"><ShieldCheck size={19} /></span><b>{orders.filter((x) => x.stageKey === "qc").length}</b><small>{t("待质检")}</small></button>
        <button onClick={() => onNavigate("stock")}><span className="metric-icon blue"><Gem size={19} /></span><b>{inventory.filter((x) => x.status === "可用").length}</b><small>{t("可用石")}</small></button>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span>ACTIVE ORDERS</span><h2>{t("进行中的订单")}</h2></div><button onClick={() => onNavigate("orders")}>{t("全部")} <ChevronRight size={15} /></button></div>
        <div className="order-stack">{orders.slice(0, 3).map(o => <OrderCard key={o.code} order={o} onOpen={onOpen} compact />)}</div>
      </section>

      <section className="quick-section">
        <div className="section-heading"><div><span>QUICK ACTIONS</span><h2>{t("快捷操作")}</h2></div></div>
        <div className="quick-grid">
          <button onClick={() => onNavigate("stock")}><span><Plus size={20} /></span><b>{t("添加裸钻")}</b><small>{t("录入证书和报价")}</small></button>
          <button onClick={() => onNavigate("orders")}><span><UploadCloud size={20} /></span><b>{t("上传进度")}</b><small>{t("照片或视频")}</small></button>
        </div>
      </section>
    </main>
  </>;
}

function OrdersPage({ orders, onOpen }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const shown = orders.filter(o => (filter === "all" || o.stageKey === filter) && (`${o.code}${o.title}`.toLowerCase().includes(query.toLowerCase())));
  return <>
    <Header title={t("订单")} eyebrow="WORK ORDERS" action={<button className="icon-button"><MoreHorizontal size={22} /></button>} />
    <main className="page-content orders-page">
      <label className="search-box"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("搜索订单号或款式")} /></label>
      <div className="filter-row">
        {[['all','全部'],['new','待确认'],['review','客户审核'],['production','制作中'],['qc','终检']].map(([key,label]) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{t(label)}</button>)}
      </div>
      <div className="list-summary"><span>{t(`${shown.length} 个订单`)}</span><button><Menu size={15} /> {t("按更新时间")}</button></div>
      <div className="order-stack full">{shown.map(o => <OrderCard key={o.code} order={o} onOpen={onOpen} />)}</div>
      {shown.length === 0 && <div className="empty-state"><Search size={28} /><h3>{t("没有找到订单")}</h3><p>{t("换个订单号或状态试试。")}</p></div>}
    </main>
  </>;
}

function DetailSection({ title, icon: Icon, children, action }) {
  return <section className="detail-section"><div className="detail-section-title"><h2><Icon size={18} />{title}</h2>{action}</div>{children}</section>;
}

function ProductionTimeline({ order, role, canUpload, onUpload }) {
  const { t } = useI18n();
  const phases = useMemo(() => WORKFLOW_PHASES.map((phase) => {
    const steps = order.steps.slice(phase.from, phase.to);
    const state = steps.some((step) => step.current) ? "current" : steps.length > 0 && steps.every((step) => step.done) ? "done" : "next";
    return { ...phase, steps, state };
  }), [order.steps]);
  const activeId = phases.find((phase) => phase.state === "current")?.id
    || [...phases].reverse().find((phase) => phase.state === "done")?.id
    || phases[0].id;
  const [selectedId, setSelectedId] = useState(activeId);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setSelectedId(activeId);
    setExpanded(true);
  }, [order.code, activeId]);

  const selected = phases.find((phase) => phase.id === selectedId) || phases[0];
  const phaseUpdates = (order.updates || []).filter((update) => selected.updateTypes.includes(update.type) && update.status !== "superseded");
  const media = phaseUpdates.flatMap((update) => (update.media || []).map((file) => ({ ...file, update })));
  const uploadAllowed = role === "vendor" && canUpload && selected.updateTypes.includes(order.task?.type);
  const statusText = selected.state === "done" ? "已完成" : selected.state === "current" ? "进行中" : "待开始";

  const selectPhase = (phaseId) => {
    if (phaseId === selectedId) setExpanded((value) => !value);
    else {
      setSelectedId(phaseId);
      setExpanded(true);
    }
  };

  return <div className="workflow-stage-view">
    <nav className="workflow-stage-rail" aria-label={t("订单制作阶段")}>
      <span className="workflow-stage-line" aria-hidden="true" />
      {phases.map((phase, index) => <button
        type="button"
        key={phase.id}
        className={`${phase.state} ${phase.id === selectedId ? "selected" : ""}`}
        onClick={() => selectPhase(phase.id)}
        aria-pressed={phase.id === selectedId}
      >
        <span className="workflow-stage-node">{phase.state === "done" ? <Check size={13} /> : phase.state === "current" ? <i /> : index + 1}</span>
        <small>{t(phase.label)}</small>
      </button>)}
    </nav>

    <button type="button" className="workflow-stage-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className="workflow-stage-number">0{phases.findIndex((phase) => phase.id === selected.id) + 1}</span>
      <span><small>{t(`阶段 ${phases.findIndex((phase) => phase.id === selected.id) + 1}`)}</small><strong>{t(selected.title)}</strong></span>
      <em className={selected.state}>{t(statusText)}</em>
      <ChevronDown size={17} className={expanded ? "open" : ""} />
    </button>

    {expanded && <div className="workflow-stage-panel">
      <div className="workflow-substeps">
        {selected.steps.map((step, index) => <div className={step.done ? "done" : step.current ? "current" : "next"} key={step.title}>
          <span className="workflow-substep-track">
            <span className="workflow-substep-node">{step.done ? <Check size={10} /> : step.current ? <i /> : null}</span>
            {index < selected.steps.length - 1 && <span className="workflow-substep-line" />}
          </span>
          <p><strong>{t(step.title)}</strong><small>{t(step.meta)}</small></p>
          {step.current && uploadAllowed && <button type="button" onClick={() => onUpload(order, order.task.type)}>{t("处理")}</button>}
        </div>)}
      </div>

      <div className="workflow-media-heading"><strong>{t("阶段资料")}</strong><span>{t(`${media.length} 项`)}</span></div>
      <div className="workflow-media-row">
        {media.map((file, index) => {
          const url = file.url || file.publicUrl;
          const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(url || "") || String(file.type || "").startsWith("video/");
          return <a href={url} target="_blank" rel="noreferrer" key={`${url || file.name}-${index}`}>
            <span className="workflow-media-preview">{url ? isVideo ? <video src={url} muted preload="metadata" /> : <img src={url} alt={file.name || t("阶段资料")} loading="lazy" /> : <FileText size={20} />}</span>
            <span><strong>{file.name || t(UPDATE_LABELS[file.update.type])}</strong><small>{t(REVIEW_LABELS[file.update.status] || file.update.status)}</small></span>
          </a>;
        })}
        {uploadAllowed && <button type="button" className="workflow-media-add" onClick={() => onUpload(order, order.task.type)}>
          <span><ImagePlus size={20} /></span><strong>{t("添加资料")}</strong><small>{t("照片 / 视频")}</small>
        </button>}
        {!media.length && !uploadAllowed && <div className="workflow-media-empty"><FileText size={18} /><span>{t(selected.state === "next" ? "此阶段尚未开始" : "此阶段暂无文件")}</span></div>}
      </div>

      {selected.state === "current" && <div className="workflow-stage-tip"><ShieldCheck size={16} /><p><strong>{t("供货商提示")}</strong>{t(order.task?.requirements?.[0] || order.waiting)}</p></div>}
    </div>}
  </div>;
}

function MediaEvidence({ item }) {
  const { t } = useI18n();
  const media = item.media || [];
  return <article className={`evidence-card ${item.status}`}>
    <div className="evidence-head">
      <div><strong>{t(UPDATE_LABELS[item.type] || item.type)} {item.version > 1 ? `v${item.version}` : ""}</strong><small>{dateLabel(item.createdAt)}</small></div>
      <span>{t(REVIEW_LABELS[item.status] || item.status)}</span>
    </div>
    {media.length > 0 && <div className="evidence-media">{media.map((file, index) => {
      const url = file.url || file.publicUrl;
      const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(url || "") || String(file.type || "").startsWith("video/");
      return <a href={url} target="_blank" rel="noreferrer" key={`${url}-${index}`} aria-label={file.name || t("查看文件")}>
        {isVideo ? <><video src={url} muted preload="metadata" /><span><Video size={13} />{t("查看视频")}</span></> : <img src={url} alt={file.name || t("上传文件")} loading="lazy" />}
      </a>;
    })}</div>}
    {item.type === "STONE" && Object.keys(item.data || {}).length > 0 && <div className="evidence-data">
      <span><small>{t("候选数量")}</small><strong>{item.data.candidateCount || "—"}</strong></span>
      <span><small>{t("批次有效期")}</small><strong>{item.data.batchValidUntil || "—"}</strong></span>
      <span><small>{t("临时保留至")}</small><strong>{item.data.temporaryHoldUntil || "未保留"}</strong></span>
      <span><small>{t("可用性")}</small><strong>{item.data.availabilityConfirmed ? t("已确认可用") : "—"}</strong></span>
      <span className="wide"><small>{t("IGI 证书号")}</small><strong>{item.data.igiNumbers || "—"}</strong></span>
    </div>}
    {item.type === "ESTIMATE" && Object.keys(item.data || {}).length > 0 && <div className="evidence-data">
      <span><small>{t("预计净金重")}</small><strong>{item.data.netWeightG || "—"} g</strong></span>
      <span><small>{t("损耗")}</small><strong>{item.data.lossPct || "0"}%</strong></span>
      <span><small>{t("工费")}</small><strong>{item.data.currency || "CNY"} {item.data.laborCost || "—"}</strong></span>
      <span><small>{t("材料费")}</small><strong>{item.data.currency || "CNY"} {item.data.materialCost || "—"}</strong></span>
      <span><small>{t("生产周期")}</small><strong>{item.data.leadTimeDays || "—"} {t("天")}</strong></span>
      <span className="wide"><small>{t("估算假设")}</small><strong>{item.data.assumptions || "—"}</strong></span>
    </div>}
    {item.type === "SHIPPING" && <div className="evidence-data">
      <span className="wide"><small>{t("物流单号")}</small><strong>{item.data?.trackingNumber || "—"}</strong></span>
    </div>}
    {item.note && <p>{item.note}</p>}
    {item.reviewNote && <div className="review-note"><AlertCircle size={14} /><span><strong>{t("订单团队反馈")}</strong>{item.reviewNote}</span></div>}
  </article>;
}

function OrderDetail({ order, role, onRoleChange, onBack, onUpload, onSaveNote, onVendorAction, onOperation }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const submitNote = async () => {
    if (!note.trim()) return;
    await onSaveNote(order, note.trim());
    setNote(""); setShowComposer(false);
  };
  const evidence = order.updates.filter((item) => item.media.length || item.reviewNote || (item.note && item.type !== "NOTE"));
  const task = order.task;
  const canUpload = role === "vendor" && Boolean(task?.type);
  const reviewActions = operationsActions(order.workflowState);
  const primaryLabel = task?.state === "changes" || task?.current ? `上传${task.label}新版本` : task?.action || "上传文件";
  return <div className="detail-view">
    <Header title={order.code} eyebrow={t("订单工作区")} onBack={onBack} action={<button className="icon-button"><MoreHorizontal size={22} /></button>} />
    <main className="detail-content">
      {DEMO_MODE && <div className="role-switch" aria-label={t("演示角色")}>
        <button className={role === "vendor" ? "active" : ""} onClick={() => onRoleChange("vendor")}>{t("供货商视角")}</button>
        <button className={role === "operations" ? "active" : ""} onClick={() => onRoleChange("operations")}>{t("Operations 审核")}</button>
      </div>}
      <section className="detail-hero">
        <div className={`detail-gem ${order.heroTone}`}><Gem size={31} /></div>
        <div><StatusBadge stageKey={order.stageKey}>{order.stage}</StatusBadge><h1>{t(order.title)}</h1><p>{t(order.customer)} · {t("交期")} {t(order.due)}</p></div>
        <div className="progress-line"><span style={{ width: `${order.progress}%` }} /></div>
        <small>{t("整体进度")} {order.progress}%</small>
      </section>

      <section className="next-action-card">
        <div className="next-action-icon">{task?.state === "approved" ? <BadgeCheck size={19} /> : task?.state === "changes" ? <AlertCircle size={19} /> : <Zap size={19} />}</div>
        <div><span>{t("当前任务")}</span><h2>{t(order.waiting)}</h2><p>{t(task?.statusLabel || "等待订单团队")}</p></div>
        {role === "vendor" && order.vendorAction && <button onClick={() => onVendorAction(order, order.vendorAction)}>{t(order.vendorLabel)}</button>}
      </section>

      {role === "operations" && <section className="ops-review-card">
        <div><ShieldCheck size={18} /><span><strong>{t("Operations 操作")}</strong><small>{t(reviewActions.length ? "审核当前 Vendor 提交内容" : "当前没有待审核提交")}</small></span></div>
        {reviewActions.length > 0 && <div>{reviewActions.map(action => <button className={action.tone} key={action.event} onClick={() => onOperation(order, action.event)}>{t(action.label)}</button>)}</div>}
      </section>}

      {task?.requirements && <section className={`task-checklist ${task.state}`}>
        <div><span>{t(task.label)}</span><strong>{t(task.statusLabel)}</strong></div>
        <ul>{task.requirements.map((item) => <li key={item}><Check size={13} />{t(item)}</li>)}</ul>
        {canUpload && <button onClick={() => onUpload(order, task.type)}>{task.state === "changes" || task.current ? <RotateCcw size={16} /> : <UploadCloud size={16} />}{t(primaryLabel)}</button>}
      </section>}

      {order.lockedDiamond && <section className="diamond-lock-card"><Gem size={20} /><div><span>{t("DIAMOND LOCKED")}</span><strong>{order.lockedDiamond}</strong><small>{t("这颗钻石已绑定当前采购任务，不能用于其他订单。")}</small></div><BadgeCheck size={20} /></section>}

      <DetailSection title={t("订单规格")} icon={FileText}>
        <div className="spec-grid">{Object.entries(order.specs).map(([label, value]) => <div key={label}><span>{t(label)}</span><strong>{t(value)}</strong></div>)}</div>
        <div className="reference-note"><span>{t("客户要求")}</span><p>{t(order.referenceNotes)}</p></div>
        {order.referenceMedia?.length > 0 && <div className="reference-files">{order.referenceMedia.map((file, index) => {
          const url = typeof file === "string" ? file : file.url || file.publicUrl;
          return <a href={url} target="_blank" rel="noreferrer" key={`${url}-${index}`}><FileText size={15} /><span>{t("参考文件")} {index + 1}</span><ChevronRight size={14} /></a>;
        })}</div>}
      </DetailSection>

      <DetailSection title={t("制作进度")} icon={Layers3} action={role === "vendor" ? <button className="text-button" onClick={() => setShowComposer(v => !v)}>{t("添加记录")}</button> : null}>
        {showComposer && <div className="note-composer"><textarea autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder={t("例如：戒臂已抛光，明天完成镶石…")} /><div><button onClick={() => setShowComposer(false)}>{t("取消")}</button><button className="primary-mini" onClick={submitNote}><Send size={14} /> {t("保存")}</button></div></div>}
        <ProductionTimeline order={order} role={role} canUpload={canUpload} onUpload={onUpload} />
      </DetailSection>

      <DetailSection title={t("订单团队反馈")} icon={MessageCircle}>
        <div className="feedback-card"><span>{t("最新反馈")}</span><p>{t(task?.current?.reviewNote || order.feedback)}</p><small>{t("由订单团队转达 · 客户联系方式已隐藏")}</small></div>
      </DetailSection>

      <DetailSection title={t("文件与版本历史")} icon={Camera} action={canUpload ? <button className="text-button" onClick={() => onUpload(order, task.type)}>{t("上传新版本")}</button> : null}>
        {evidence.length ? <div className="evidence-list">{evidence.map(item => <MediaEvidence key={item.id} item={item} />)}</div> : <button className="media-empty" disabled={!canUpload} onClick={() => canUpload && onUpload(order, task.type)}><ImagePlus size={24} /><strong>{t("还没有上传文件")}</strong><span>{t(canUpload ? "从当前任务开始上传，提交后会保留版本历史。" : "订单团队开放任务后即可上传。")}</span></button>}
      </DetailSection>
    </main>
    <div className="detail-actions">
      {role === "operations" ? reviewActions.map(action => <button key={action.event} className={action.tone === "primary" ? "primary-action" : "secondary-action"} onClick={() => onOperation(order, action.event)}>{action.event === "APPROVE" || action.event === "COMPLETE" ? <Check size={19} /> : <RotateCcw size={19} />}{t(action.label)}</button>) : <>
        <button className="secondary-action" onClick={() => setShowComposer(true)}><MessageCircle size={19} /> {t("添加说明")}</button>
        {order.vendorAction ? <button className="primary-action" onClick={() => onVendorAction(order, order.vendorAction)}><Check size={19} /> {t(order.vendorLabel)}</button>
          : <button className="primary-action" disabled={!canUpload} onClick={() => canUpload && onUpload(order, task.type)}><UploadCloud size={19} /> {t(primaryLabel)}</button>}
      </>}
    </div>
  </div>;
}

function InventoryPage({ inventory, onAdd }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("全部");
  const shown = inventory.filter(s => filter === "全部" || s.status === filter);
  return <>
    <Header title={t("裸钻库存")} eyebrow="DIAMOND POOL" action={<button className="round-add" onClick={onAdd}><Plus size={20} /></button>} />
    <main className="page-content stock-page">
      <section className="stock-overview"><div><span>{t("可用库存")}</span><strong>{inventory.filter((x) => x.status === "可用").length}</strong><small>{t("颗裸钻")}</small></div><div><span>{t("库存成本")}</span><strong>${inventory.reduce((sum, x) => sum + (Number(String(x.price).replace(/[^0-9.]/g, "")) || 0), 0).toLocaleString()}</strong><small>{t("当前可用")}</small></div></section>
      <div className="filter-row stock-filters">{["全部", "可用", "已预留", "已售"].map(x => <button className={filter === x ? "active" : ""} onClick={() => setFilter(x)} key={x}>{t(x)}</button>)}</div>
      <div className="stock-list">{shown.map(stone => <article key={stone.id} className="stone-card">
        <div className="stone-icon"><Gem size={24} /></div>
        <div className="stone-main"><div><span>{stone.id}</span><StatusBadge stageKey={stone.status === "可用" ? "production" : stone.status === "已预留" ? "review" : "done"}>{stone.status}</StatusBadge></div><h3>{t(stone.shape)} · {stone.carat}ct</h3><p>{stone.grade} · {stone.cert}</p><small><Camera size={13} /> {t(`${stone.media} 个影像`)}</small></div>
        <div className="stone-price"><strong>{stone.price}</strong><ChevronRight size={17} /></div>
      </article>)}</div>
      <button className="wide-outline" onClick={onAdd}><Plus size={18} /> {t("添加一颗裸钻")}</button>
    </main>
  </>;
}

function ProfilePage({ onToast, supplier, onLogout }) {
  const { t, locale } = useI18n();
  const brand = vendorBrand(locale);
  const [showLanguage, setShowLanguage] = useState(false);
  const localeLabel = LOCALES.find(x => x.id === locale)?.label || "中文";
  return <>
    <Header title={t("我的")} eyebrow="WORKSHOP" />
    <main className="page-content profile-page">
      <section className="profile-card"><div className="profile-logo">{brand.mark}</div><div><h2>{supplier?.displayName || t("华南工坊")}</h2><p>{supplier?.supplierCode || t("供应商 ID · CN-01")}</p><StatusBadge stageKey="production">合作中</StatusBadge></div></section>
      <section className="month-card"><div><span>{t("本月已完成")}</span><strong>12</strong><small>{t("个订单")}</small></div><div><span>{t("准时交付率")}</span><strong>96%</strong><small>{t("近 90 天")}</small></div></section>
      <div className="settings-list">
        <button onClick={() => onToast(t("通知设置已打开"))}><span><Bell size={19} />{t("通知设置")}</span><ChevronRight size={18} /></button>
        <button onClick={() => onToast(t("账号由平台管理"))}><span><UserRound size={19} />{t("账号与工坊资料")}</span><ChevronRight size={18} /></button>
        <button onClick={() => setShowLanguage(true)}><span><Settings size={19} />{t("语言与显示")}</span><em>{localeLabel}</em><ChevronRight size={18} /></button>
        <button onClick={() => onToast(t("数据通过加密连接同步"))}><span><ShieldCheck size={19} />{t("数据与隐私")}</span><ChevronRight size={18} /></button>
      </div>
      <button className="logout-button" onClick={onLogout}><LogOut size={18} />{t("退出登录")}</button>
      <p className="version">{brand.name} Workshop · v0.1 prototype</p>
    </main>
    {showLanguage && <LanguageSheet onClose={() => setShowLanguage(false)} />}
  </>;
}

function Sheet({ title, onClose, children }) {
  const { t } = useI18n();
  return <div className="sheet-layer"><button className="sheet-backdrop" aria-label={t("关闭")} onClick={onClose} /><section className="sheet"><div className="sheet-handle" /><div className="sheet-heading"><h2>{title}</h2><button onClick={onClose} aria-label={t("关闭")}><X size={20} /></button></div>{children}</section></div>;
}

function LanguageSheet({ onClose }) {
  const { t, locale, setLocale } = useI18n();
  return <Sheet title={t("选择语言")} onClose={onClose}><div className="sheet-body language-sheet"><p>{t("界面语言会保存在此设备上。")}</p>{LOCALES.map(item => <button key={item.id} className={locale === item.id ? "active" : ""} onClick={() => { setLocale(item.id); onClose(); }}><span>{item.short}</span><strong>{item.label}</strong>{locale === item.id && <Check size={18} />}</button>)}</div></Sheet>;
}

function UploadSheet({ order, kind, onClose, onDone }) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState("");
  const [data, setData] = useState(kind === "STONE"
    ? { candidateCount: "10", batchValidUntil: "", temporaryHoldUntil: "", igiNumbers: "", availabilityConfirmed: false }
    : kind === "ESTIMATE"
      ? { netWeightG: "", lossPct: "6", laborCost: "", materialCost: "", leadTimeDays: "", currency: "CNY", assumptions: "" }
      : kind === "SHIPPING"
        ? { trackingNumber: "" }
      : {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const task = TASKS[kind] || TASKS.PROGRESS;
  const structuredValid = kind === "STONE"
    ? Number(data.candidateCount) > 0 && data.batchValidUntil && data.igiNumbers.trim() && data.availabilityConfirmed
    : kind === "ESTIMATE"
      ? Number(data.netWeightG) > 0 && data.laborCost !== "" && data.materialCost !== "" && Number(data.leadTimeDays) > 0 && data.assumptions.trim()
      : kind === "SHIPPING"
        ? data.trackingNumber.trim()
      : true;
  const setDataField = (key, value) => setData(current => ({ ...current, [key]: value }));
  const submit = async () => {
    if (!files.length) return;
    setBusy(true); setError("");
    try {
      let media = files.map(file => ({ name: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file) }));
      let update;
      if (!DEMO_MODE) {
        const uploaded = await Promise.all(files.map(file => uploadVendorMedia(file, order.code, kind)));
        media = uploaded.map((object, i) => ({ name: files[i].name, type: files[i].type, size: files[i].size, ...object }));
        update = (await vendorApi.addUpdate(order.code, { type: kind, note, media, data })).update;
      } else {
        const priorVersions = order.updates.filter(item => item.type === kind).map(item => item.version || 1);
        update = { id: `demo-${Date.now()}`, type: kind, note, media, data, version: Math.max(0, ...priorVersions) + 1, status: "submitted", createdAt: new Date().toISOString() };
      }
      await onDone(t(kind === "SHIPPING" ? "寄件信息已记录" : `${files.length} 个文件已提交审核`), update);
    } catch (e) {
      setError(t(e.code === "UPLOAD_FAILED" ? "文件上传失败，请重试" : "提交失败，请稍后重试"));
    } finally { setBusy(false); }
  };
  return <Sheet title={`${t("上传到")} ${order?.code || t("订单")}`} onClose={onClose}>
    <div className="sheet-body upload-sheet">
      <div className="locked-task"><span>{t("当前任务")}</span><strong>{t(task.label)}</strong><small>{t("文件会绑定到这个任务，不能改成其他阶段。")}</small></div>
      <ul className="upload-requirements">{task.requirements.map(item => <li key={item}><Check size={13} />{t(item)}</li>)}</ul>
      {kind === "STONE" && <div className="structured-form">
        <div className="two-col"><label>{t("候选数量")}<input type="number" min="1" max="20" value={data.candidateCount} onChange={e => setDataField("candidateCount", e.target.value)} /></label><label>{t("批次有效期")}<input type="date" value={data.batchValidUntil} onChange={e => setDataField("batchValidUntil", e.target.value)} /></label></div>
        <label>{t("IGI 证书号（每行一个）")}<textarea value={data.igiNumbers} onChange={e => setDataField("igiNumbers", e.target.value)} placeholder="IGI 655482310&#10;IGI 655482311" /></label>
        <label>{t("临时保留至（选填）")}<input type="datetime-local" value={data.temporaryHoldUntil} onChange={e => setDataField("temporaryHoldUntil", e.target.value)} /></label>
        <label className="availability-check"><input type="checkbox" checked={data.availabilityConfirmed} onChange={e => setDataField("availabilityConfirmed", e.target.checked)} /><span>{t("我已确认以上候选当前可用，并会在填写的临时保留期内保留")}</span></label>
      </div>}
      {kind === "ESTIMATE" && <div className="structured-form">
        <div className="two-col"><label>{t("预计净金重（g）")}<input inputMode="decimal" value={data.netWeightG} onChange={e => setDataField("netWeightG", e.target.value)} /></label><label>{t("损耗（%）")}<input inputMode="decimal" value={data.lossPct} onChange={e => setDataField("lossPct", e.target.value)} /></label></div>
        <div className="two-col"><label>{t("工费")}<input inputMode="decimal" value={data.laborCost} onChange={e => setDataField("laborCost", e.target.value)} /></label><label>{t("配石／材料费")}<input inputMode="decimal" value={data.materialCost} onChange={e => setDataField("materialCost", e.target.value)} /></label></div>
        <div className="two-col"><label>{t("币种")}<select value={data.currency} onChange={e => setDataField("currency", e.target.value)}><option value="CNY">CNY</option><option value="USD">USD</option></select></label><label>{t("生产周期（天）")}<input type="number" min="1" value={data.leadTimeDays} onChange={e => setDataField("leadTimeDays", e.target.value)} /></label></div>
        <label>{t("估算假设")}<textarea value={data.assumptions} onChange={e => setDataField("assumptions", e.target.value)} placeholder={t("例如：US 6 戒围、1.5ct 主石尺寸、PT950…")} /></label>
      </div>}
      {kind === "SHIPPING" && <div className="structured-form">
        <label>{t("物流单号")}<input value={data.trackingNumber} onChange={e => setDataField("trackingNumber", e.target.value)} placeholder={t("请输入快递或物流单号")} autoComplete="off" /></label>
      </div>}
      <button className="upload-drop" onClick={() => inputRef.current?.click()}><span><UploadCloud size={25} /></span><strong>{t(files.length ? "继续添加照片或视频" : "选择多张照片或视频")}</strong><small>{t("可一次选择或分次添加多张 · 视频单个最大 200MB")}</small></button>
      <input ref={inputRef} hidden multiple accept="image/*,video/*" type="file" onChange={e => {
        setFiles(current => mergeSelectedFiles(current, [...e.target.files]));
        e.target.value = "";
      }} />
      {files.length > 0 && <div className="file-list">{files.map((file, index) => <div key={`${file.name}-${file.size}`}><FileText size={17} /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span><button aria-label={t("移除文件")} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X size={15} /></button></div>)}</div>}
      <label>{t(kind === "SHIPPING" ? "寄件说明（选填）" : "进度说明（选填）")}</label><textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t(kind === "SHIPPING" ? "例如：已使用顺丰寄出，包装完好…" : "说明这次更新完成了什么、下一步是什么…")} />
      <div className="privacy-tip"><ShieldCheck size={17} /><p><strong>{t("安全直传")}</strong> {t("文件从手机直接上传到腾讯云 COS，API 只保存对象标识。")}</p></div>
      {error && <p className="upload-error"><AlertCircle size={15} />{error}</p>}
      <button className="sheet-submit" disabled={!files.length || !structuredValid || busy} onClick={submit}>{busy ? t("正在上传…") : `${t(kind === "SHIPPING" ? "确认包裹已寄出" : "提交订单团队审核")}${files.length ? ` · ${files.length}` : ""}`}</button>
    </div>
  </Sheet>;
}

function AddStoneSheet({ onClose, onDone }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ shape: "圆形", carat: "", color: "E", clarity: "VS1", cert: "", price: "" });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm(v => ({ ...v, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      if (!DEMO_MODE) {
        await vendorApi.saveStone({
          supplierSku: form.cert,
          certificateNo: form.cert,
          shape: form.shape,
          carat: Number(form.carat),
          color: form.color,
          clarity: form.clarity,
          procurementCostUsd: Number(form.price),
          availability: "available",
        });
      }
      await onDone(t("裸钻已添加到库存池"));
    } finally { setBusy(false); }
  };
  return <Sheet title={t("添加裸钻")} onClose={onClose}><div className="sheet-body stone-form">
    <div className="two-col"><label>{t("形状")}<select value={form.shape} onChange={e => set("shape", e.target.value)}>{["圆形","椭圆","祖母绿形","公主方","梨形"].map(x => <option key={x} value={x}>{t(x)}</option>)}</select></label><label>{t("克拉")}<input inputMode="decimal" value={form.carat} onChange={e => set("carat", e.target.value)} placeholder="1.50" /></label></div>
    <div className="two-col"><label>{t("颜色")}<select value={form.color} onChange={e => set("color", e.target.value)}>{["D","E","F","G","H"].map(x => <option key={x}>{x}</option>)}</select></label><label>{t("净度")}<select value={form.clarity} onChange={e => set("clarity", e.target.value)}>{["IF","VVS1","VVS2","VS1","VS2"].map(x => <option key={x}>{x}</option>)}</select></label></div>
    <label>{t("IGI 证书号")}<input value={form.cert} onChange={e => set("cert", e.target.value)} placeholder={t("例如 655482310")} /></label>
    <label>{t("供应价（USD）")}<input inputMode="decimal" value={form.price} onChange={e => set("price", e.target.value)} placeholder={t("例如 510")} /></label>
    <button className="upload-drop mini"><span><Camera size={22} /></span><strong>{t("添加实拍与证书照片")}</strong><small>{t("至少 1 张，建议包含 360° 视频")}</small></button>
    <button className="sheet-submit" disabled={!form.carat || !form.cert || !form.price || busy} onClick={save}>{busy ? t("正在保存…") : t("保存裸钻")}</button>
  </div></Sheet>;
}

function LoginPage({ onAuthenticated }) {
  const { t, locale } = useI18n();
  const brand = vendorBrand(locale);
  const parameters = new URLSearchParams(window.location.search);
  const token = parameters.get("token");
  const resetToken = parameters.get("reset");
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      if (forgot) {
        await vendorApi.requestPasswordReset(email);
        setMessage(t("如果该邮箱对应有效账号，我们已经发送了密码重置链接。"));
        return;
      }
      if ((token || resetToken) && password !== confirmation) {
        setError(t("两次输入的密码不一致"));
        return;
      }
      const result = token ? await vendorApi.acceptInvite(token, password)
        : resetToken ? await vendorApi.confirmPasswordReset(resetToken, password)
          : await vendorApi.login(email, password);
      if (token || resetToken) window.history.replaceState({}, "", window.location.pathname);
      onAuthenticated(result.supplier);
    } catch (e) {
      setError(e.code === "INVALID_CREDENTIALS" ? t("邮箱或密码不正确")
        : e.code === "SUPPLIER_PASSWORD_RESET_INVALID" ? t("重置链接无效或已过期")
          : t("登录失败，请稍后重试"));
    } finally { setBusy(false); }
  };
  const title = token ? "设置密码并激活账号" : resetToken ? "设置新密码" : forgot ? "重置密码" : "供应商工作台";
  const subtitle = token ? "此邀请链接将在使用后失效。"
    : resetToken ? "请输入新的登录密码。"
      : forgot ? "输入登录邮箱，我们会发送一个一小时内有效的重置链接。"
        : "使用平台分配的账号登录。";
  return <main className="login-page">
    <div className="login-brand"><span>{brand.mark}</span><p>{brand.name}</p><h1>{t(title)}</h1><small>{t(subtitle)}</small></div>
    <form className="login-card" onSubmit={submit}>
      {!token && !resetToken && <label>{t("邮箱")}<input required autoComplete="username" inputMode="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
      {!forgot && <label>{t(token ? "设置密码" : resetToken ? "新密码" : "密码")}<input required autoComplete={token || resetToken ? "new-password" : "current-password"} type="password" minLength="8" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
      {(token || resetToken) && <label>{t("确认新密码")}<input required autoComplete="new-password" type="password" minLength="8" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>}
      {error && <p className="login-error">{error}</p>}
      {message && <p className="login-message">{message}</p>}
      <button disabled={busy || (forgot ? !email : password.length < 8 || ((token || resetToken) && confirmation.length < 8))}>{busy ? t("请稍候…") : t(forgot ? "发送重置链接" : token ? "激活并登录" : resetToken ? "重置并登录" : "登录")}</button>
      {!token && !resetToken && <button className="login-link" type="button" onClick={() => { setForgot(value => !value); setError(""); setMessage(""); }}>{t(forgot ? "返回登录" : "忘记密码？")}</button>}
    </form>
    <p className="login-foot"><ShieldCheck size={14} />{t("客户联系方式、零售价与付款信息不会显示在此端。")}</p>
  </main>;
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [role, setRole] = useState("vendor");
  const [selected, setSelected] = useState(null);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [addStone, setAddStone] = useState(false);
  const [toast, setToast] = useState("");
  const [supplier, setSupplier] = useState(DEMO_MODE ? { displayName: "华南工坊", supplierCode: "SUP-DEMO" } : undefined);
  const [orders, setOrders] = useState(DEMO_MODE ? initialOrders.map(demoOrderView) : []);
  const [inventory, setInventory] = useState(DEMO_MODE ? initialInventory : []);

  useEffect(() => {
    if (DEMO_MODE) return;
    let current = true;
    let loading = false;

    const applyOrders = (rows) => {
      const nextOrders = rows.map(apiOrderView);
      setOrders(nextOrders);
      // Keep an open order detail current too. The list endpoint intentionally
      // omits version history, so preserve the detailed updates already loaded.
      setSelected((open) => {
        if (!open) return open;
        const fresh = nextOrders.find((order) => order.code === open.code);
        return fresh ? { ...open, ...fresh, updates: open.updates } : open;
      });
    };

    const loadInitialWorkspace = async () => {
      if (loading) return;
      loading = true;
      try {
        const me = await vendorApi.me();
        const [orderResult, inventoryResult] = await Promise.all([vendorApi.orders(), vendorApi.inventory()]);
        if (!current) return;
        setSupplier(me.supplier);
        applyOrders(orderResult.orders);
        setInventory(inventoryResult.inventory.map(apiInventoryView));
      } catch {
        if (current) setSupplier(null);
      } finally {
        loading = false;
      }
    };

    const refreshOrders = async () => {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const orderResult = await vendorApi.orders();
        if (current) applyOrders(orderResult.orders);
      } catch (error) {
        if (current && (error?.status === 401 || error?.status === 403)) setSupplier(null);
      } finally {
        loading = false;
      }
    };

    loadInitialWorkspace();
    const refreshVisible = () => { if (document.visibilityState === "visible") refreshOrders(); };
    const interval = window.setInterval(refreshOrders, 12000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);

  const showToast = (message) => { setToast(message); window.clearTimeout(showToast.t); showToast.t = window.setTimeout(() => setToast(""), 2600); };
  const navigate = (next) => { setTab(next); setSelected(null); setRole("vendor"); window.scrollTo(0, 0); };
  const openOrder = async (order) => {
    setSelected(order); window.scrollTo(0, 0);
    if (!DEMO_MODE) {
      try {
        const detail = await vendorApi.order(order.code);
        setSelected(apiOrderView(detail.order));
      } catch { showToast("无法加载订单详情"); }
    }
  };
  const replaceOrder = (next) => {
    setSelected(next);
    setOrders(current => current.map(item => item.code === next.code ? next : item));
  };
  const refreshOrder = async (code) => {
    const detail = await vendorApi.order(code);
    const next = apiOrderView(detail.order);
    replaceOrder(next);
    return next;
  };
  const saveNote = async (order, note) => {
    if (DEMO_MODE) {
      replaceOrder(applyDemoUpdate(order, { id: `demo-note-${Date.now()}`, type: "NOTE", note, status: "approved", createdAt: new Date().toISOString() }));
    } else {
      await vendorApi.addUpdate(order.code, { type: "NOTE", note });
      await refreshOrder(order.code);
    }
    showToast("进度说明已保存");
  };
  const vendorWorkflowAction = async (order, action) => {
    if (DEMO_MODE) {
      if (action === "ACCEPT") {
        replaceOrder(applyDemoUpdate(order, { id: `demo-ack-${Date.now()}`, type: "ACKNOWLEDGE", status: "approved", createdAt: new Date().toISOString() }));
      } else {
        replaceOrder(rebuildDemoOrder(order, transitionWorkflow(order.workflowState, action, { productLine: order.productLine }), order.updates));
      }
    } else {
      await vendorApi.changeStage(order.code, { type: action });
      await refreshOrder(order.code);
    }
    showToast(action === "ACCEPT"
      ? order.productLine === "multi" ? "任务已接受，现在请提交供应报价" : "任务已接受，现在请提交订单专属候选钻"
      : action === "CONFIRM_PRODUCTION" ? "已确认开工，制作进度任务已开放" : "已确认并准备交付");
  };
  const operateWorkflow = async (order, event) => {
    if (!DEMO_MODE) return;
    const reviewNote = event === "REQUEST_CHANGES"
      ? order.workflowState.startsWith("CANDIDATES") ? "请补足候选数量，并补齐证书与正面视频。"
        : order.workflowState.startsWith("ESTIMATE") ? "请补充损耗假设、材料费和明确生产周期。"
          : "请按审核要求补充关键尺寸和侧面视图。"
      : "";
    replaceOrder(applyDemoOperation(order, event, reviewNote));
    showToast(event === "REQUEST_CHANGES" ? "已退回 Vendor 修改"
      : event === "LOCK_DIAMOND" ? "客户选择已记录，钻石已锁定"
        : event === "CONFIRM_DEPOSIT" ? "定金已确认，CAD 任务已开放"
          : event === "COMPLETE" ? "订单履约已完成" : "流程已更新");
  };
  const authenticated = async (nextSupplier) => {
    const [orderResult, inventoryResult] = await Promise.all([vendorApi.orders(), vendorApi.inventory()]);
    setSupplier(nextSupplier);
    setOrders(orderResult.orders.map(apiOrderView));
    setInventory(inventoryResult.inventory.map(apiInventoryView));
  };
  const logout = async () => {
    if (!DEMO_MODE) await vendorApi.logout().catch(() => {});
    if (!DEMO_MODE) setSupplier(null);
  };
  const page = useMemo(() => {
    if (selected) return <OrderDetail order={selected} role={role} onRoleChange={setRole} onBack={() => setSelected(null)} onUpload={(order, kind) => setUploadTarget({ order, kind })} onSaveNote={saveNote} onVendorAction={vendorWorkflowAction} onOperation={operateWorkflow} />;
    if (tab === "orders") return <OrdersPage orders={orders} onOpen={openOrder} />;
    if (tab === "stock") return <InventoryPage inventory={inventory} onAdd={() => setAddStone(true)} />;
    if (tab === "me") return <ProfilePage onToast={showToast} supplier={supplier} onLogout={logout} />;
    return <HomePage orders={orders} inventory={inventory} supplier={supplier} onOpen={openOrder} onNavigate={navigate} />;
  }, [tab, role, selected, orders, inventory, supplier]);

  if (supplier === undefined) return <div className="app-shell"><div className="mobile-app loading-page"><div className="loading-mark">得</div></div></div>;
  if (supplier === null) return <div className="app-shell"><div className="mobile-app"><LoginPage onAuthenticated={authenticated} /></div></div>;
  return <div className="app-shell">
    <div className="mobile-app">
      {page}
      {!selected && <BottomNav current={tab} onChange={navigate} orderCount={orders.length} />}
      {uploadTarget && <UploadSheet order={uploadTarget.order} kind={uploadTarget.kind} onClose={() => setUploadTarget(null)} onDone={async (message, update) => {
        if (DEMO_MODE) replaceOrder(applyDemoUpdate(uploadTarget.order, update));
        else await refreshOrder(uploadTarget.order.code);
        setUploadTarget(null); showToast(message);
      }} />}
      {addStone && <AddStoneSheet onClose={() => setAddStone(false)} onDone={async (message) => {
        if (!DEMO_MODE) {
          const result = await vendorApi.inventory();
          setInventory(result.inventory.map(apiInventoryView));
        }
        setAddStone(false); showToast(message);
      }} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  </div>;
}
