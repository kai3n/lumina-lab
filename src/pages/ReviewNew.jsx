import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth.jsx";
import { apiFetch } from "../lib/api.js";
import { buildReviewMediaPayload } from "../lib/reviewMedia.js";
import { listOpsOrders, listReviews, portalView } from "../lib/store.js";
import { useDBVersion } from "../lib/useDB.js";
import { useLocale } from "../i18n.jsx";
import ReviewForm from "../components/ReviewForm.jsx";

// "Share your moment" — 홈에서 바로 들어오는 리뷰 작성 플로우.
// 실서버(BD-) 우선: 주문번호+운송장 또는 로그인 소유권으로 인증, 제출은 pending → 어드민 검수.
// 서버 부재(정적 데모)나 서버에 없는 DM- 주문은 레거시 로컬 스토어로 폴백.
const COPY = {
  en: {
    title: "Share your moment", sub: "Delivered orders can post photos and video with a verified review.",
    orderId: "Order number", code: "Tracking number", codePh: "From your shipping email", verify: "Verify my order",
    invalid: "We couldn't find that order, or it hasn't been delivered yet.",
    already: "This order already has a review — thank you!",
    pick: "Choose a delivered order", none: "No delivered orders yet — your moment is coming.",
    done: "Thank you. Your review is being curated and will appear on our homepage soon.",
    back: "Back to home", forOrder: (id) => `Review for ${id}`,
    error: "Could not submit — please try again.",
  },
  ko: {
    title: "내 순간 남기기", sub: "배송 완료된 주문은 사진·영상과 함께 인증 리뷰를 남길 수 있어요.",
    orderId: "주문번호", code: "운송장 번호", codePh: "발송 메일에 있는 번호", verify: "주문 인증하기",
    invalid: "주문을 찾을 수 없거나 아직 배송 완료 전입니다.",
    already: "이 주문에는 이미 리뷰가 있어요 — 감사합니다!",
    pick: "배송 완료된 주문 선택", none: "아직 배송 완료된 주문이 없어요 — 곧 당신의 순간이 옵니다.",
    done: "감사합니다. 검수 후 홈페이지에 곧 게시됩니다.",
    back: "홈으로", forOrder: (id) => `${id} 리뷰`,
    error: "제출에 실패했어요 — 다시 시도해주세요.",
  },
  zh: {
    title: "分享你的瞬间", sub: "已送达的订单可上传照片或视频，留下认证评价。",
    orderId: "订单号", code: "运单号", codePh: "见发货邮件", verify: "验证我的订单",
    invalid: "未找到该订单，或尚未送达。",
    already: "该订单已有评价 — 谢谢！",
    pick: "选择已送达的订单", none: "还没有已送达的订单 — 你的瞬间即将到来。",
    done: "谢谢。审核后将很快展示在首页。",
    back: "返回首页", forOrder: (id) => `${id} 的评价`,
    error: "提交失败，请重试。",
  },
  es: {
    title: "Comparte tu momento", sub: "Los pedidos entregados pueden publicar fotos y video con una reseña verificada.",
    orderId: "Número de pedido", code: "Número de seguimiento", codePh: "Del correo de envío", verify: "Verificar mi pedido",
    invalid: "No encontramos ese pedido, o aún no fue entregado.",
    already: "Este pedido ya tiene una reseña — ¡gracias!",
    pick: "Elige un pedido entregado", none: "Aún no hay pedidos entregados — tu momento llegará.",
    done: "Gracias. Tu reseña se curará y aparecerá pronto en nuestra página.",
    back: "Volver al inicio", forOrder: (id) => `Reseña de ${id}`,
    error: "No se pudo enviar — inténtalo de nuevo.",
  },
};

const DONE_STATUSES = ["DELIVERED", "ARCHIVED"];

export default function ReviewNew() {
  useDBVersion();
  const { p, locale } = useLocale();
  const c = COPY[locale] || COPY.en;
  const rc = p.portalReview || {};
  const { user } = useAuth();
  const [orderId, setOrderId] = useState("");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(null); // { mode: "server"|"demo", orderCode }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [serverDelivered, setServerDelivered] = useState([]);

  // 로그인 고객: 실서버 배송 완료 주문은 운송장 없이 소유권으로 바로 선택
  useEffect(() => {
    if (!user) { setServerDelivered([]); return undefined; }
    let cancelled = false;
    apiFetch("/orders")
      .then((d) => {
        if (cancelled) return;
        setServerDelivered((d.orders || []).filter((o) => o.stage === "DELIVERED").map((o) => o.orderCode));
      })
      .catch(() => { /* 서버 부재(데모)·서버 미로그인 — 데모 목록만 보인다 */ });
    return () => { cancelled = true; };
  }, [user]);

  // 레거시 데모 주문 (정적 데모 빌드 전용)
  const myDelivered = user
    ? listOpsOrders({ customerId: user.id }).filter((o) => DONE_STATUSES.includes(o.status))
    : [];

  function verifyDemo(id) {
    const view = portalView(id, { customerId: user?.id, userRole: user?.role, queryCode: code.trim().toUpperCase() });
    if (!view || !DONE_STATUSES.includes(view.order.status)) { setError(c.invalid); return; }
    if (listReviews({ orderId: id }).some((r) => r.status !== "hidden")) { setError(c.already); return; }
    setError("");
    setVerified({ mode: "demo", orderCode: id });
  }

  async function verify(e) {
    e.preventDefault();
    if (busy) return;
    const id = orderId.trim().toUpperCase();
    const tracking = code.trim();
    setBusy(true);
    try {
      await apiFetch("/reviews/verify", { method: "POST", body: { orderCode: id, tracking } });
      setError("");
      setVerified({ mode: "server", orderCode: id, tracking });
      return;
    } catch (err) {
      if (err?.code === "REVIEW_EXISTS") { setError(c.already); return; }
      // 서버 부재(정적 데모)·서버에 없는 DM- 데모 주문 → 레거시 스토어 폴백
      verifyDemo(id);
    } finally {
      setBusy(false);
    }
  }

  async function pickServerOrder(orderCode) {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch("/reviews/verify", { method: "POST", body: { orderCode } });
      setError("");
      setVerified({ mode: "server", orderCode, tracking: "" });
    } catch (err) {
      setError(err?.code === "REVIEW_EXISTS" ? c.already : c.invalid);
    } finally { setBusy(false); }
  }

  function pickOrder(id) {
    if (listReviews({ orderId: id }).some((r) => r.status !== "hidden")) { setError(c.already); return; }
    setError("");
    setVerified({ mode: "demo", orderCode: id });
  }

  // 실서버 제출은 모든 선택 파일의 원격 업로드가 끝났을 때만 진행한다.
  const serverSubmit = verified?.mode === "server"
    ? async ({ rating, quote, body, media }) => {
      await apiFetch("/reviews", {
        method: "POST",
        body: {
          orderCode: verified.orderCode, tracking: verified.tracking || "",
          rating, quote, body,
          media: buildReviewMediaPayload(media),
        },
      });
    }
    : undefined;

  const pickerOrders = [
    ...serverDelivered.map((id) => ({ id, server: true })),
    ...myDelivered.filter((o) => !serverDelivered.includes(o.id)).map((o) => ({ id: o.id, server: false })),
  ];

  return (
    <div className="page page-narrow">
      <h1 className="page-title">{c.title}</h1>
      <p className="page-sub">{c.sub}</p>

      {done ? (
        <div className="panel form-stack">
          <p className="form-hint" style={{ fontSize: 15 }}>{c.done}</p>
          <Link className="button primary" to="/">{c.back}</Link>
        </div>
      ) : verified ? (
        <div className="panel form-stack">
          <p className="section-label">{c.forOrder(verified.orderCode)}</p>
          <ReviewForm
            orderId={verified.orderCode}
            submit={serverSubmit}
            rc={{
              mediaLbl: rc.mediaLbl || "Photos & video first (max 5)",
              rating: rc.rating || "Rating",
              quoteLbl: rc.quoteLbl || "One line",
              quotePh: rc.quotePh || "She said yes.",
              bodyLbl: rc.bodyLbl || "Your story (optional)",
              note: rc.note || "Verified with your order number. Curated before publishing.",
              submit: rc.submit || "Submit review",
              error: c.error,
            }}
            onDone={() => setDone(true)}
          />
        </div>
      ) : (
        <>
          {pickerOrders.length > 0 && (
            <div className="panel form-stack" style={{ marginBottom: 14 }}>
              <p className="section-label">{c.pick}</p>
              <div className="row-actions">
                {pickerOrders.map((o) => (
                  <button key={o.id} className="button secondary small"
                    onClick={() => (o.server ? pickServerOrder(o.id) : pickOrder(o.id))}>{o.id}</button>
                ))}
              </div>
            </div>
          )}
          {user && pickerOrders.length === 0 && <p className="form-hint" style={{ marginBottom: 14 }}>{c.none}</p>}
          <form className="panel form-stack" onSubmit={verify}>
            <label className="field"><span>{c.orderId}</span>
              <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="BD-100001" required />
            </label>
            <label className="field"><span>{c.code}</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={c.codePh} required />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button primary" type="submit" disabled={busy}>{c.verify}</button>
          </form>
        </>
      )}
    </div>
  );
}
