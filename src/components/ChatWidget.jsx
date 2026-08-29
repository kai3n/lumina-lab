import { Fragment, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, HelpCircle, Home, ImagePlus, Instagram, Mail, MessageCircle, Send, UserRound, Video, X } from "lucide-react";
import { useLocale } from "../i18n.jsx";
import { bookConsultation, fetchChatConfig, fetchConsultationSlots, fetchThread, saveChatEmail, sendChatMessage, submitCsat, uploadChatImage, chatMediaFiles, CHAT_MAX_BYTES, CHAT_VIDEO_MAX_BYTES } from "../lib/chat.js";
import { faqChips } from "../lib/chatFaq.js";
import ChatThumb from "./ChatThumb.jsx";
import "../chat.css";

// 위젯을 숨길 경로 — 어드민 콘솔·스태프 게이트(같은 Layout 안에서 렌더되므로 여기서 차단)
const BLOCKED = (path) => path.startsWith("/bo-") || path.startsWith("/gate-") || path.startsWith("/admin");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_CHAT_CONFIG = {
  humanHandoffEnabled: false,
  contact: {
    email: "support@belovediamond.com",
    instagramHandle: "@belovediamondjewelry",
    instagramUrl: "https://www.instagram.com/belovediamondjewelry/",
  },
};

const COPY = {
  en: {
    title: "Messages", open: "Chat with us",
    greeting: "Hi! Questions about a design, sizing, or an order? Our team usually replies within a few minutes.",
    placeholder: "Write a message…", emailToggle: "Get a reply by email too?", emailPh: "your@email.com", emailSaved: "We'll reply by email too ✓",
    powered: "BeloveD concierge", drop: "Drop a photo or video", attach: "Attach photo or video",
    tooLarge: "That file is too large (max 100MB).", tooLargeVideo: "Videos must be under 30MB.",
    menu: "Menu", backToChat: "Back to chat", talk: "Talk to a person", talkMsg: "I'd like to talk to a person.",
    book: "Book a video consultation", bookLead: "Tell us when works and we'll set up a video call.",
    bookName: "Your name", bookWhen: "Preferred time (e.g. Sat afternoon)", bookContact: "Email (for the video link)",
    bookNote: "Anything to prepare? (optional)", bookSend: "Request consultation", bookCancel: "Cancel",
    bookDone: "Booked! We've emailed the details and video link.",
    bookPick: "Pick a 20-min slot", bookNoSlots: "No open times right now — leave a note and we'll reach out.",
    bookTaken: "That time was just taken — please pick another.", bookTzPrefix: "Your timezone:",
    joined: "A BeloveD specialist has joined the conversation",
    escalateLead: "Sorry I couldn't quite help — would you like to talk to a person?",
    contactLead: "Need personal help? Reach us directly:", contactEmail: "Email", contactInstagram: "Instagram",
    nudgeMsg: "Questions? I'm here to help — ask me anything.",
    csatLead: "How was this conversation?", csatThanks: "Thanks for your feedback!",
    quickTitle: "Or jump to",
    quick: [
      { id: "order", label: "Start a custom order", to: "/custom/new" },
      { id: "designs", label: "Browse designs", to: "/designs" },
      { id: "track", label: "Track my order", to: "/track" },
      { id: "home", label: "Back to home", to: "/" },
    ],
  },
  ko: {
    title: "메시지", open: "문의하기",
    greeting: "안녕하세요! 디자인·사이즈·주문 관련 무엇이든 물어보세요. 보통 몇 분 안에 답장드려요.",
    placeholder: "메시지를 입력하세요…", emailToggle: "이메일로도 답장받기", emailPh: "your@email.com", emailSaved: "이메일로도 답장드릴게요 ✓",
    powered: "BeloveD 컨시어지", drop: "사진·영상을 여기에 놓으세요", attach: "사진·영상 첨부",
    tooLarge: "파일이 너무 커요 (최대 100MB).", tooLargeVideo: "영상은 30MB까지 올릴 수 있어요.",
    menu: "메뉴", backToChat: "대화로 돌아가기", talk: "상담원 연결", talkMsg: "상담원과 연결해 주세요.",
    book: "화상 상담 예약", bookLead: "편한 시간을 알려주시면 화상 상담을 잡아드려요.",
    bookName: "이름", bookWhen: "희망 시간 (예: 토요일 오후)", bookContact: "이메일 (화상 링크 받을 주소)",
    bookNote: "미리 준비할 내용이 있나요? (선택)", bookSend: "상담 예약 요청", bookCancel: "취소",
    bookDone: "예약 완료! 상세 내용과 화상 링크를 이메일로 보냈어요.",
    bookPick: "20분 슬롯을 선택하세요", bookNoSlots: "지금은 빈 시간이 없어요 — 메모를 남겨주시면 연락드릴게요.",
    bookTaken: "방금 예약된 시간이에요 — 다른 시간을 골라주세요.", bookTzPrefix: "내 시간대:",
    joined: "BeloveD 상담원이 대화에 참여했어요",
    escalateLead: "제가 잘 못 도와드린 것 같아요 — 상담원과 연결해 드릴까요?",
    contactLead: "직접 도움이 필요하신가요? 아래로 연락해 주세요:", contactEmail: "이메일", contactInstagram: "Instagram",
    nudgeMsg: "궁금한 점 있으세요? 편하게 물어보세요 :)",
    csatLead: "이 대화, 어떠셨나요?", csatThanks: "평가 감사합니다!",
    quickTitle: "바로가기",
    quick: [
      { id: "order", label: "주문제작 시작하기", to: "/custom/new" },
      { id: "designs", label: "디자인 둘러보기", to: "/designs" },
      { id: "track", label: "주문 조회", to: "/track" },
      { id: "home", label: "홈으로 돌아가기", to: "/" },
    ],
  },
  zh: {
    title: "消息", open: "在线咨询",
    greeting: "您好！关于设计、尺寸或订单有任何问题都可以问我们，通常几分钟内回复。",
    placeholder: "输入消息…", emailToggle: "也用邮件回复我", emailPh: "your@email.com", emailSaved: "我们也会邮件回复您 ✓",
    powered: "BeloveD 礼宾", drop: "拖放照片或视频到此处", attach: "添加照片或视频",
    tooLarge: "文件过大（最大 100MB）。", tooLargeVideo: "视频需小于 30MB。",
    menu: "菜单", backToChat: "返回对话", talk: "联系人工", talkMsg: "我想联系人工客服。",
    book: "预约视频咨询", bookLead: "告诉我们方便的时间，我们安排视频通话。",
    bookName: "您的姓名", bookWhen: "期望时间（如周六下午）", bookContact: "邮箱（接收视频链接）",
    bookNote: "需要提前准备什么吗？（可选）", bookSend: "预约咨询", bookCancel: "取消",
    bookDone: "预约成功！详情与视频链接已发送至您的邮箱。",
    bookPick: "选择一个 20 分钟时段", bookNoSlots: "暂无空闲时段——留言给我们，我们会联系您。",
    bookTaken: "该时段刚被预约——请另选一个。", bookTzPrefix: "您的时区：",
    joined: "BeloveD 顾问已加入对话",
    escalateLead: "抱歉没能帮到您——需要联系人工吗？",
    contactLead: "需要人工帮助？请通过以下方式联系我们：", contactEmail: "邮箱", contactInstagram: "Instagram",
    nudgeMsg: "有疑问吗？随时问我 :)",
    csatLead: "这次对话怎么样？", csatThanks: "感谢您的反馈！",
    quickTitle: "快捷前往",
    quick: [
      { id: "order", label: "开始定制", to: "/custom/new" },
      { id: "designs", label: "浏览设计", to: "/designs" },
      { id: "track", label: "订单查询", to: "/track" },
      { id: "home", label: "返回首页", to: "/" },
    ],
  },
  es: {
    title: "Mensajes", open: "Chatea con nosotros",
    greeting: "¡Hola! ¿Preguntas sobre un diseño, tallas o un pedido? Solemos responder en unos minutos.",
    placeholder: "Escribe un mensaje…", emailToggle: "¿Respuesta por correo también?", emailPh: "tu@email.com", emailSaved: "También responderemos por correo ✓",
    powered: "BeloveD concierge", drop: "Suelta una foto o video", attach: "Adjuntar foto o video",
    tooLarge: "Ese archivo es muy grande (máx. 100MB).", tooLargeVideo: "Los videos deben ser menores de 30MB.",
    menu: "Menú", backToChat: "Volver al chat", talk: "Hablar con una persona", talkMsg: "Quiero hablar con una persona.",
    book: "Reservar videoconsulta", bookLead: "Dinos cuándo te viene bien y agendamos una videollamada.",
    bookName: "Tu nombre", bookWhen: "Hora preferida (p. ej. sábado tarde)", bookContact: "Correo (para el enlace de video)",
    bookNote: "¿Algo que preparar? (opcional)", bookSend: "Solicitar consulta", bookCancel: "Cancelar",
    bookDone: "¡Reservado! Te enviamos los detalles y el enlace de video por correo.",
    bookPick: "Elige un espacio de 20 min", bookNoSlots: "No hay horarios disponibles — deja una nota y te contactamos.",
    bookTaken: "Ese horario se acaba de reservar — elige otro.", bookTzPrefix: "Tu zona horaria:",
    joined: "Un especialista de BeloveD se unió a la conversación",
    escalateLead: "Perdón si no pude ayudarte — ¿quieres hablar con una persona?",
    contactLead: "¿Necesitas ayuda personal? Contáctanos directamente:", contactEmail: "Email", contactInstagram: "Instagram",
    nudgeMsg: "¿Preguntas? Estoy aquí para ayudarte.",
    csatLead: "¿Qué tal esta conversación?", csatThanks: "¡Gracias por tu opinión!",
    quickTitle: "O ve a",
    quick: [
      { id: "order", label: "Iniciar pedido personalizado", to: "/custom/new" },
      { id: "designs", label: "Ver diseños", to: "/designs" },
      { id: "track", label: "Seguir mi pedido", to: "/track" },
      { id: "home", label: "Volver al inicio", to: "/" },
    ],
  },
};

function initials(name) {
  return String(name || "B").trim().slice(0, 1).toUpperCase();
}
function hhmm(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function Avatar({ agent, className = "" }) {
  if (agent?.avatar) return <img className={`chat-avatar ${className}`} src={agent.avatar} alt={agent.name} />;
  return <div className={`chat-avatar ${className}`} aria-hidden="true">{initials(agent?.name)}</div>;
}

function ContactLinks({ t, contact, compact = false }) {
  return (
    <div className={compact ? "chat-contact chat-contact--compact" : "chat-contact"}>
      {!compact && <div className="chat-contact-lead">{t.contactLead}</div>}
      <a href={`mailto:${contact.email}`}>
        <Mail size={compact ? 13 : 15} strokeWidth={1.9} />
        <span>{compact ? t.contactEmail : contact.email}</span>
      </a>
      <a href={contact.instagramUrl} target="_blank" rel="noopener noreferrer">
        <Instagram size={compact ? 13 : 15} strokeWidth={1.9} />
        <span>{compact ? t.contactInstagram : contact.instagramHandle}</span>
      </a>
    </div>
  );
}

// 첨부 렌더 — 이미지·영상 공용. thumb=작은 미리보기(합성 대기), 아니면 대화 본문.
function AttachMedia({ a, thumb }) {
  if (String(a.contentType || "").startsWith("video/")) {
    return thumb
      ? <video src={a.url} muted playsInline />
      : <video src={a.url} controls preload="metadata" />;
  }
  return <img src={a.url} alt={a.name || "attachment"} loading="lazy" />;
}

export default function ChatWidget() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { locale } = useLocale();
  const t = COPY[locale] || COPY.en;
  const chips = faqChips(locale);
  const hidden = BLOCKED(pathname);

  // 기본은 최소화(작은 로고 버블) — 화면을 가리지 않는다. ?chat=open(이메일 CTA)일 때만
  // 자동으로 펼친다. 페이지 이동(SPA)에는 Layout 상시 마운트로 열림 상태가 그대로 유지되고,
  // 대화 내용은 bd_chat 쿠키(서버 스레드)로 유지된다.
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("chat") === "open";
  });
  const [messages, setMessages] = useState([]);
  const [thread, setThread] = useState(null);
  const [agent, setAgent] = useState(null);
  const [unread, setUnread] = useState(0);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const [emailOpen, setEmailOpen] = useState(false); // 이메일 입력 펼침
  const [emailSaved, setEmailSaved] = useState(false);
  const [pending, setPending] = useState([]); // 첨부 대기 [{url,contentType,name}]
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [dockH, setDockH] = useState(0); // 모바일 스티키 독(.noir-dock) 높이 — 최소화 버블을 그 위로
  const [pastHero, setPastHero] = useState(true); // 홈 히어로 구간에선 버블 숨김(스크롤하면 등장)
  const [menuOpen, setMenuOpen] = useState(false); // 홈/메뉴 뷰 — 헤더 ⌂로 토글, 대화 후 막다른 길 방지
  const [consultOpen, setConsultOpen] = useState(false); // 화상 상담 예약 폼
  const [consult, setConsult] = useState({ name: "", contact: "", note: "", slot: "" });
  const [slots, setSlots] = useState([]); // 예약 가능 슬롯(UTC ISO)
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotDay, setSlotDay] = useState(""); // 선택한 로컬 날짜 키
  const [notice, setNotice] = useState(""); // 성공 안내(예약 접수 등)
  const [escalate, setEscalate] = useState(false); // 자동응답 연속 실패 → 상담원 연결 제안
  const [nudge, setNudge] = useState(false); // 선제 인사
  const [rated, setRated] = useState(false); // CSAT 평가 완료
  const [chatConfig, setChatConfig] = useState(DEFAULT_CHAT_CONFIG);

  const humanHandoffEnabled = chatConfig.humanHandoffEnabled === true;
  const contact = { ...DEFAULT_CHAT_CONFIG.contact, ...(chatConfig.contact || {}) };

  const lastIdRef = useRef(0);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const missRef = useRef(0); // 연속 FAQ 미스 카운트
  const threadCodeRef = useRef(null); // 현재 스레드 코드 — 서버가 다른 스레드로 바뀌면 커서 리셋

  function ingest(data) {
    if (!data) return;
    if (data.staffAgent) setAgent(data.staffAgent);
    if (data.thread !== undefined) {
      const prevCode = threadCodeRef.current;
      const nextCode = data.thread?.code || null;
      threadCodeRef.current = nextCode;
      setThread(data.thread);
      if (!data.thread) {
        // 스레드가 사라짐(로그아웃 등으로 bd_chat 제거) → 로컬 대화도 즉시 초기화
        setMessages([]); lastIdRef.current = 0; setUnread(0); setEmailSaved(false); setConsultOpen(false); setRated(false);
        return;
      }
      if (prevCode && prevCode !== nextCode) {
        // 서버가 다른 스레드로 전환 → 초기화하고 이번 응답 메시지는 버린다
        // (다음 폴이 since=0으로 새 스레드를 온전히 로드해 이전 대화 잔존·커서 가림 방지)
        setMessages([]); lastIdRef.current = 0; setEmailSaved(false); setConsultOpen(false); setRated(false);
        setUnread(data.thread.customerUnread || 0);
        return;
      }
      setUnread(data.thread.customerUnread || 0);
    }
    if (data.messages?.length) {
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = data.messages.filter((m) => !seen.has(m.id));
        if (!fresh.length) return prev;
        return [...prev, ...fresh].sort((a, b) => a.id - b.id);
      });
      lastIdRef.current = Math.max(lastIdRef.current, ...data.messages.map((m) => m.id));
      // 실제 상담원이 붙으면 에스컬레이션 상태 해제
      if (data.messages.some((m) => m.sender === "staff" && m.senderAdminId != null)) {
        missRef.current = 0; setEscalate(false);
      }
    }
  }

  // 폴링: 열림=3s(읽음처리), 닫힘=15s(peek, 미확인 뱃지만)
  useEffect(() => {
    if (hidden) return undefined;
    let alive = true;
    fetchChatConfig()
      .then((data) => {
        if (!alive) return;
        setChatConfig({
          humanHandoffEnabled: data?.humanHandoffEnabled === true,
          contact: { ...DEFAULT_CHAT_CONFIG.contact, ...(data?.contact || {}) },
        });
      })
      .catch(() => { /* fail closed: keep handoff off and show fallback contacts */ });
    return () => { alive = false; };
  }, [hidden]);

  useEffect(() => {
    if (hidden) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const data = await fetchThread({ since: lastIdRef.current, peek: !open });
        if (alive) ingest(data);
      } catch { /* 서버 부재·오프라인 — 조용히 무시 */ }
    };
    tick();
    const id = window.setInterval(tick, open ? 3000 : 15000);
    return () => { alive = false; window.clearInterval(id); };
  }, [open, hidden]);

  const showMenu = menuOpen || messages.length === 0;

  // 대화 뷰일 때 새 메시지 오면 맨 아래로
  useEffect(() => {
    if (open && !showMenu && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, open, showMenu]);

  // 접근성 — 열렸을 때 Esc로 위젯 닫기(캡처 단계로 사이트 뒤로가기보다 먼저, 위젯만 닫는다)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // 모바일 스티키 독(.noir-dock)이 보이면 최소화 버블을 독 높이만큼 위로 올려 '주문제작 시작'
  // 버튼과 겹치지 않게 한다. 스크롤 중 등장/리사이즈에도 대응(값이 그대로면 리렌더 없음).
  useEffect(() => {
    let raf = 0;
    const check = () => {
      const dock = document.querySelector(".noir-dock");
      setDockH(dock && dock.getClientRects().length > 0 ? Math.round(dock.getBoundingClientRect().height) : 0);
    };
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; check(); }); };
    check();
    const id = window.setTimeout(check, 400);
    window.addEventListener("resize", check);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", check);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  // 홈 히어로(영상 컨트롤·CTA가 우하단에 몰린 구간)에선 최소화 버블을 숨겼다가, 조금 스크롤하면
  // 등장시킨다 — 코너 혼잡을 피하고 '둘러본 뒤 등장'이라 전환에도 유리. 다른 페이지는 항상 표시.
  useEffect(() => {
    if (pathname !== "/") { setPastHero(true); return undefined; }
    const check = () => setPastHero(window.scrollY > window.innerHeight * 0.6);
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [pathname]);

  // 선제 인사 — 인텐트 페이지(디자인·주문·가이드)에서 25초 체류 후, 세션당 1회, 대화 없을 때만.
  useEffect(() => {
    if (open) return undefined;
    let dismissed = false;
    try { dismissed = window.sessionStorage.getItem("bd_chat_nudged") === "1"; } catch { /* no-op */ }
    if (dismissed || !/^\/(designs|custom|orders|track|guide)/.test(pathname)) return undefined;
    const id = window.setTimeout(() => { if (messages.length === 0) setNudge(true); }, 25000);
    return () => window.clearTimeout(id);
  }, [pathname, open, messages.length]);

  function dismissNudge() {
    setNudge(false);
    try { window.sessionStorage.setItem("bd_chat_nudged", "1"); } catch { /* no-op */ }
  }

  // CSAT — 낙관적: 즉시 감사로 전환 후 전송(실패해도 UI 유지)
  async function rateCsat(n) {
    setRated(true);
    try { await submitCsat(n); } catch { /* 무시 */ }
  }

  // 파일 업로드 공용 — 파일선택·드래그앤드롭·붙여넣기 모두 여기로. 이미지·영상만, 다중 지원.
  async function uploadFiles(list) {
    const files = chatMediaFiles(list);
    if (!files.length) return;
    setUploading(true); setError("");
    try {
      for (const file of files) {
        const isVideo = file.type.startsWith("video/");
        if (file.size > (isVideo ? CHAT_VIDEO_MAX_BYTES : CHAT_MAX_BYTES)) {
          setError(isVideo ? t.tooLargeVideo : t.tooLarge); continue;
        }
        try {
          const url = await uploadChatImage(file, file.type);
          setPending((p) => [...p, { url, contentType: file.type, name: file.name }]);
        } catch { setError("Upload failed — try again."); }
      }
    } finally { setUploading(false); }
  }

  function onFileInput(e) {
    uploadFiles(e.target.files).finally(() => { if (fileRef.current) fileRef.current.value = ""; });
  }
  function onDrop(e) { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer?.files); }
  function onDragOver(e) { e.preventDefault(); if (!dragOver) setDragOver(true); }
  function onDragLeave(e) { if (e.currentTarget.contains(e.relatedTarget)) return; setDragOver(false); }
  function onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) { if (it.kind === "file") { const f = it.getAsFile(); if (f) files.push(f); } }
    const media = chatMediaFiles(files);
    if (media.length) { e.preventDefault(); uploadFiles(media); }
  }

  async function doSend(text) {
    const body = String(text || "").trim();
    if ((!body && pending.length === 0) || sending) return;
    setMenuOpen(false); // 보내면 대화 뷰로
    setSending(true); setError("");
    try {
      const data = await sendChatMessage({ body, attachments: pending, locale, email: email.trim() || undefined });
      setPending([]);
      // 방문자 메시지 + (있으면) FAQ 자동응답을 즉시 반영 — 폴링에서도 dedup됨
      ingest({
        staffAgent: data.staffAgent, thread: data.thread,
        messages: [data.message, ...(data.autoReply ? [data.autoReply] : [])],
      });
      // 3-스트라이크: 자동응답이 못 맞추면 미스 누적 → 2회면 상담원 연결 제안
      if (data.autoReply || !humanHandoffEnabled) { missRef.current = 0; setEscalate(false); }
      else { missRef.current += 1; if (missRef.current >= 2) setEscalate(true); }
    } catch { setError("Could not send — please try again."); }
    finally { setSending(false); }
  }

  function handleSend() {
    const body = input.trim();
    if (!body && pending.length === 0) return;
    setInput("");
    doSend(body);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // 사이트 페이지로 이동하는 빠른 액션 — 위젯은 접어 페이지가 보이게 한다
  function goto(to) { setOpen(false); navigate(to); }

  // 오프라인 이메일 답장용 주소만 저장 (메시지 없이도)
  async function saveEmail() {
    const v = email.trim();
    if (!EMAIL_RE.test(v)) return;
    try { await saveChatEmail(v, locale); setEmailSaved(true); setEmailOpen(false); }
    catch { setError("Could not save email — try again."); }
  }

  // 화상 상담 예약 요청 제출
  // 예약 가능 슬롯 로드 — 폼 열릴 때 + 더블부킹 시 갱신
  function loadSlots() {
    setSlotsLoading(true);
    fetchConsultationSlots()
      .then((d) => setSlots(d.slots || []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }
  useEffect(() => { if (consultOpen) loadSlots(); }, [consultOpen]);

  async function submitConsult() {
    if (!consult.slot || !EMAIL_RE.test(consult.contact.trim()) || sending) return;
    setSending(true); setError("");
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await bookConsultation({ ...consult, tz, locale });
      setConsult({ name: "", contact: "", note: "", slot: "" });
      setConsultOpen(false); setMenuOpen(false);
      ingest({ staffAgent: data.staffAgent, thread: data.thread, messages: [data.message] });
      setNotice(t.bookDone);
      window.setTimeout(() => setNotice(""), 7000);
    } catch (e) {
      if (e?.status === 409 || e?.code === "SLOT_TAKEN") {
        setError(t.bookTaken); setConsult((s) => ({ ...s, slot: "" })); loadSlots();
      } else setError("Could not send — please try again.");
    } finally { setSending(false); }
  }

  if (hidden) return null;

  const showEmail = !thread?.customerId && !thread?.visitorEmail;
  const firstHumanId = messages.find((m) => m.sender === "staff" && m.senderAdminId != null)?.id;

  // 슬롯 캘린더 — 서버 슬롯(UTC)을 방문자 로컬 시간대로 날짜/시간 그룹핑
  const visitorTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
  const slotGroups = (() => {
    const byDay = {}; const days = [];
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: visitorTz, year: "numeric", month: "2-digit", day: "2-digit" });
    const dayLbl = new Intl.DateTimeFormat(locale, { timeZone: visitorTz, weekday: "short", month: "short", day: "numeric" });
    const timeLbl = new Intl.DateTimeFormat(locale, { timeZone: visitorTz, hour: "numeric", minute: "2-digit" });
    for (const iso of slots) {
      const d = new Date(iso); const k = dayKey.format(d);
      if (!byDay[k]) { byDay[k] = []; days.push({ key: k, label: dayLbl.format(d) }); }
      byDay[k].push({ iso, label: timeLbl.format(d) });
    }
    return { byDay, days };
  })();
  const activeDay = slotDay && slotGroups.byDay[slotDay] ? slotDay : (slotGroups.days[0]?.key || "");

  if (!open) {
    return (
      <div className={`chat-root${pastHero ? "" : " chat-root--hidden"}`} style={dockH ? { bottom: `calc(${dockH + 14}px + env(safe-area-inset-bottom))` } : undefined}>
        {nudge && (
          <div className="chat-nudge" role="button" tabIndex={0}
            onClick={() => { setNudge(false); setOpen(true); }}
            onKeyDown={(e) => { if (e.key === "Enter") { setNudge(false); setOpen(true); } }}>
            <span>{t.nudgeMsg}</span>
            <button className="chat-nudge-x" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismissNudge(); }}>×</button>
          </div>
        )}
        <button className="chat-launcher" aria-label={t.open} onClick={() => { setNudge(false); setOpen(true); }}>
          <MessageCircle size={26} strokeWidth={1.8} />
          {unread > 0 && <span className="chat-badge">{unread > 9 ? "9+" : unread}</span>}
        </button>
      </div>
    );
  }

  const quickActions = (
    <div className="chat-quick">
      <div className="chat-quick-label">{t.quickTitle}</div>
      {t.quick.map((q) => (
        <button key={q.id} type="button" className="chat-quick-btn" onClick={() => goto(q.to)}>{q.label}</button>
      ))}
    </div>
  );

  return (
    <div className="chat-root">
      <div
        className="chat-panel" role="dialog" aria-label={t.title}
        onDragEnter={onDragOver} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onPaste={onPaste}
      >
        {dragOver && <div className="chat-dropzone">{t.drop}</div>}
        <div className="chat-head">
          <Avatar agent={agent} />
          <div className="chat-head-meta">
            <div className="chat-head-name">{agent?.name || "BeloveD"}</div>
            <div className="chat-head-sub"><span className="chat-online-dot" />{agent?.title || t.powered}</div>
          </div>
          {messages.length > 0 && (
            <button className="chat-icon-btn" aria-label={showMenu ? t.backToChat : t.menu}
              onClick={() => setMenuOpen((v) => !v)}>
              {showMenu ? <MessageCircle size={19} strokeWidth={1.9} /> : <Home size={19} strokeWidth={1.9} />}
            </button>
          )}
          <button className="chat-icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={19} strokeWidth={1.9} />
          </button>
        </div>

        <div className="chat-body" ref={bodyRef} role="log" aria-live="polite">
          {consultOpen ? (
            <div className="chat-consult">
              <div className="chat-consult-lead">{t.bookLead}</div>
              <input className="chat-consult-input" placeholder={t.bookName} value={consult.name}
                onChange={(e) => setConsult((s) => ({ ...s, name: e.target.value }))} />

              {/* 20분 슬롯 캘린더 — 방문자 로컬 시간대로 표시 */}
              <div className="chat-slot-picker">
                <div className="chat-slot-title">{t.bookPick}</div>
                {slotsLoading ? (
                  <div className="chat-slot-empty">…</div>
                ) : slotGroups.days.length === 0 ? (
                  <div className="chat-slot-empty">{t.bookNoSlots}</div>
                ) : (
                  <>
                    <div className="chat-slot-days">
                      {slotGroups.days.map((d) => (
                        <button key={d.key} type="button"
                          className={`chat-slot-day${activeDay === d.key ? " on" : ""}`}
                          onClick={() => setSlotDay(d.key)}>{d.label}</button>
                      ))}
                    </div>
                    <div className="chat-slot-times">
                      {(slotGroups.byDay[activeDay] || []).map((s) => (
                        <button key={s.iso} type="button"
                          className={`chat-slot-time${consult.slot === s.iso ? " on" : ""}`}
                          onClick={() => setConsult((c) => ({ ...c, slot: s.iso }))}>{s.label}</button>
                      ))}
                    </div>
                    <div className="chat-slot-tz">{t.bookTzPrefix} {visitorTz}</div>
                  </>
                )}
              </div>

              <input className="chat-consult-input" placeholder={t.bookContact} value={consult.contact}
                onChange={(e) => setConsult((s) => ({ ...s, contact: e.target.value }))} />
              <textarea className="chat-consult-input" rows={2} placeholder={t.bookNote} value={consult.note}
                onChange={(e) => setConsult((s) => ({ ...s, note: e.target.value }))} />
              <div className="chat-consult-actions">
                <button type="button" className="chat-quick-btn" onClick={() => setConsultOpen(false)}>{t.bookCancel}</button>
                <button type="button" className="chat-consult-send"
                  disabled={sending || !consult.slot || !EMAIL_RE.test(consult.contact.trim())} onClick={submitConsult}>
                  {t.bookSend}
                </button>
              </div>
            </div>
          ) : showMenu ? (
            <div className="chat-greeting">
              <Avatar agent={agent} className="chat-greeting-avatar" />
              {messages.length === 0 && <div>{t.greeting}</div>}
              <div className="chat-chips">
                {chips.map((c) => (
                  <button key={c.id} type="button" className="chat-chip" disabled={sending} onClick={() => doSend(c.label)}>
                    {c.label}
                  </button>
                ))}
              </div>
              {quickActions}
              <button type="button" className="chat-quick-btn chat-book" onClick={() => setConsultOpen(true)}>
                <Video size={15} strokeWidth={1.9} /> {t.book}
              </button>
              {humanHandoffEnabled ? (
                <button type="button" className="chat-quick-btn chat-talk" onClick={() => doSend(t.talkMsg)}>
                  <UserRound size={15} strokeWidth={1.9} /> {t.talk}
                </button>
              ) : <ContactLinks t={t} contact={contact} />}
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <Fragment key={m.id}>
                  {m.id === firstHumanId && <div className="chat-joined">✦ {t.joined}</div>}
                  <div className={`chat-msg ${m.sender}`}>
                    {m.body && <span>{m.body}</span>}
                    {(m.attachments || []).map((a, i) => <ChatThumb key={i} a={a} />)}
                    {m.sender !== "system" && <span className="chat-msg-time">{hhmm(m.createdAt)}</span>}
                  </div>
                </Fragment>
              ))}
              {humanHandoffEnabled && escalate && (
                <div className="chat-escalate">
                  <span>{t.escalateLead}</span>
                  <button type="button" onClick={() => { setEscalate(false); doSend(t.talkMsg); }}>{t.talk}</button>
                </div>
              )}
              {thread?.status === "closed" && !thread?.csat && messages.length > 0 && (
                <div className="chat-csat">
                  {rated ? (
                    <span className="chat-csat-thanks">✓ {t.csatThanks}</span>
                  ) : (
                    <>
                      <span>{t.csatLead}</span>
                      <div className="chat-csat-stars">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <button key={n} type="button" aria-label={`${n} / 5`} onClick={() => rateCsat(n)}>★</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 대화 뷰에서 늘 보이는 액션 바 — 막다른 길 방지(메뉴로 돌아가기 / 상담원 연결) */}
        {!showMenu && !consultOpen && (
          <div className="chat-actionbar">
            <button type="button" onClick={() => setMenuOpen(true)}><HelpCircle size={14} strokeWidth={1.9} /> {t.menu}</button>
            {/* 에스컬레이션 카드가 이미 '상담원 연결'을 노출 중이면 중복 버튼 숨김 */}
            {humanHandoffEnabled
              ? (!escalate && <button type="button" onClick={() => doSend(t.talkMsg)}><UserRound size={14} strokeWidth={1.9} /> {t.talk}</button>)
              : <ContactLinks t={t} contact={contact} compact />}
          </div>
        )}

        <div className="chat-foot">
          {error && <div className="chat-error">{error}</div>}
          {notice && <div className="chat-notice">{notice}</div>}
          {!consultOpen && <>
          {pending.length > 0 && (
            <div className="chat-attachments">
              {pending.map((a, i) => (
                <div className="chat-attachment" key={i}>
                  <AttachMedia a={a} thumb />
                  <button aria-label="Remove" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          {showEmail && !emailSaved && (emailOpen ? (
            <div className="chat-email-row">
              <Mail className="chat-email-icon" size={14} strokeWidth={1.9} aria-hidden="true" />
              <input
                type="email" value={email} placeholder={t.emailPh} autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEmail(); } }}
              />
              <button type="button" className="chat-email-save" aria-label="Save email"
                disabled={!EMAIL_RE.test(email.trim())} onClick={saveEmail}>
                <Check size={15} strokeWidth={2.2} />
              </button>
            </div>
          ) : (
            <button type="button" className="chat-email-toggle" onClick={() => setEmailOpen(true)}>
              <Mail size={13} strokeWidth={1.9} /> {t.emailToggle}
            </button>
          ))}
          {emailSaved && <div className="chat-email-done"><Check size={13} strokeWidth={2.2} /> {t.emailSaved}</div>}
          <div className="chat-composer">
            <button className="chat-attach" aria-label={t.attach} disabled={uploading}
              onClick={() => fileRef.current?.click()}>
              <ImagePlus size={18} strokeWidth={1.8} />
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={onFileInput} />
            <textarea
              rows={1} value={input} placeholder={t.placeholder}
              onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
            />
            <button className="chat-send" aria-label="Send" disabled={sending || (!input.trim() && pending.length === 0)}
              onClick={handleSend}>
              <Send size={17} strokeWidth={1.9} />
            </button>
          </div>
          <div className="chat-powered">✦ {t.powered}</div>
          </>}
        </div>
      </div>
    </div>
  );
}
