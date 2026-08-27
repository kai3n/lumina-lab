import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api.js";
import { MediaPicker, MediaThumb, Stars } from "../../components/ui.jsx";
import { useLocale } from "../../i18n.jsx";
import { buildReviewMediaPayload } from "../../lib/reviewMedia.js";
import { ConsoleHead } from "./console.jsx";

// 홈 "Loved & Worn" 리뷰 큐레이션 — 실서버(Postgres) CRUD.
// 고객 제출은 pending으로 들어오고, 여기서 게시해야 홈에 노출된다.
const COPY = {
  en: { title: "Customer Reviews", sub: "Everything shown on the home feed. Customer submissions arrive as pending — publish to show them.", add: "Add review", edit: "Edit", del: "Delete", delAsk: "Delete this review permanently?", publish: "Publish", hide: "Hide", save: "Save", cancel: "Cancel", name: "Name", location: "Location", rating: "Rating (1–5, 0.5 steps)", quote: "One line", body: "Story", media: "Media (max 5)", order: "Order no. (optional)", status: "Status", empty: "No reviews yet." },
  ko: { title: "고객 리뷰", sub: "홈 피드에 노출되는 리뷰 전체입니다. 고객 제출은 pending으로 들어오고, 게시해야 노출돼요.", add: "리뷰 추가", edit: "수정", del: "삭제", delAsk: "이 리뷰를 완전히 삭제할까요?", publish: "게시", hide: "숨김", save: "저장", cancel: "취소", name: "이름", location: "지역", rating: "별점 (1–5 · 0.5 단위)", quote: "한 줄", body: "본문", media: "미디어 (최대 5)", order: "주문번호 (선택)", status: "상태", empty: "아직 리뷰가 없어요." },
  zh: { title: "客户评价", sub: "首页展示的全部评价。客户提交为 pending，发布后才会展示。", add: "添加评价", edit: "编辑", del: "删除", delAsk: "确定永久删除该评价？", publish: "发布", hide: "隐藏", save: "保存", cancel: "取消", name: "姓名", location: "地区", rating: "评分（1–5，0.5 步进）", quote: "一句话", body: "正文", media: "媒体（最多 5）", order: "订单号（可选）", status: "状态", empty: "还没有评价。" },
  es: { title: "Reseñas de clientes", sub: "Todo lo que aparece en el feed del inicio. Los envíos de clientes llegan como pendientes — publícalos para mostrarlos.", add: "Agregar reseña", edit: "Editar", del: "Eliminar", delAsk: "¿Eliminar esta reseña permanentemente?", publish: "Publicar", hide: "Ocultar", save: "Guardar", cancel: "Cancelar", name: "Nombre", location: "Ubicación", rating: "Calificación (1–5, pasos de 0.5)", quote: "Una línea", body: "Historia", media: "Medios (máx. 5)", order: "N.º de pedido (opcional)", status: "Estado", empty: "Aún no hay reseñas." },
};

const EMPTY = { id: "", orderCode: "", name: "", location: "", rating: 5, quote: "", body: "", media: [], status: "published" };

export default function AdminReviews() {
  const { locale } = useLocale();
  const c = COPY[locale] || COPY.en;
  const [reviews, setReviews] = useState([]);
  const [draft, setDraft] = useState(null); // null | 편집중 객체
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  function openDraft(next) {
    setUploadBusy(false);
    setUploadError("");
    setError("");
    setDraft(next);
  }

  function closeDraft() {
    setUploadBusy(false);
    setUploadError("");
    setDraft(null);
  }

  const load = useCallback(async () => {
    try {
      const d = await apiFetch("/admin/reviews");
      setReviews(d.reviews || []);
      setError("");
    } catch (e) {
      setError(e.code || e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(fn) {
    setBusy(true);
    try { await fn(); await load(); } catch (e) { setError(e.code || e.message); } finally { setBusy(false); }
  }

  function save() {
    if (!draft.quote.trim() || busy || uploadBusy || uploadError) return;
    let media;
    try {
      media = buildReviewMediaPayload(draft.media, { allowRootRelative: true });
    } catch (e) {
      setError(e.code || e.message);
      return;
    }
    const body = {
      name: draft.name, location: draft.location, rating: Number(draft.rating) || 5,
      quote: draft.quote, body: draft.body,
      media,
      status: draft.status,
    };
    call(async () => {
      if (draft.id) await apiFetch(`/admin/reviews/${draft.id}`, { method: "PATCH", body });
      else await apiFetch("/admin/reviews", { method: "POST", body: { ...body, orderCode: draft.orderCode || "" } });
      closeDraft();
    });
  }

  const setStatus = (id, status) => call(() => apiFetch(`/admin/reviews/${id}`, { method: "PATCH", body: { status } }));
  const remove = (id) => { if (window.confirm(c.delAsk)) call(() => apiFetch(`/admin/reviews/${id}`, { method: "DELETE" })); };

  return (
    <>
      <ConsoleHead kicker="Loved & Worn" title={c.title} sub={c.sub}>
        <button className="button primary small" onClick={() => openDraft({ ...EMPTY })}>{c.add}</button>
      </ConsoleHead>

      {error && <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>}

      {draft && (
        <div className="panel form-stack" style={{ marginBottom: 18 }}>
          <div className="filter-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <label className="field"><span>{c.name}</span><input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="field"><span>{c.location}</span><input value={draft.location} onChange={(e) => set({ location: e.target.value })} /></label>
            <label className="field"><span>{c.rating}</span><input type="number" min="1" max="5" step="0.5" value={draft.rating} onChange={(e) => set({ rating: e.target.value })} /></label>
            <label className="field"><span>{c.order}</span>
              <input value={draft.orderCode || ""} onChange={(e) => set({ orderCode: e.target.value })} placeholder="BD-100001" disabled={Boolean(draft.id)} />
            </label>
          </div>
          <label className="field"><span>{c.quote}</span><input value={draft.quote} onChange={(e) => set({ quote: e.target.value })} /></label>
          <label className="field"><span>{c.body}</span><textarea rows={2} value={draft.body} onChange={(e) => set({ body: e.target.value })} /></label>
          <div className="field"><span>{c.media}</span>
            <MediaPicker
              value={draft.media}
              onChange={(m) => set({ media: m })}
              maxItems={5}
              showSamples={false}
              previewMode="list"
              scope="review"
              remoteRequired
              onBusyChange={setUploadBusy}
              onErrorChange={setUploadError}
            />
          </div>
          <label className="field" style={{ maxWidth: 220 }}><span>{c.status}</span>
            <select value={draft.status} onChange={(e) => set({ status: e.target.value })}>
              {["published", "pending", "hidden"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <div className="row-actions">
            <button className="button primary small" disabled={!draft.quote.trim() || busy || uploadBusy || Boolean(uploadError)} onClick={save}>{c.save}</button>
            <button className="button secondary small" onClick={closeDraft}>{c.cancel}</button>
          </div>
        </div>
      )}

      {reviews.length === 0 && !draft && <p className="form-hint">{c.empty}</p>}
      <div className="card-grid cols-3">
        {reviews.map((r) => (
          <div className="item-card" key={r.id}>
            {r.media[0] && <MediaThumb media={r.media[0]} ratio="4 / 3" alt={r.quote} fit="contain" />}
            <div className="card-body">
              <div className="row-actions" style={{ justifyContent: "space-between" }}>
                <span className={`status-badge ${r.status === "published" ? "mst-done" : r.status === "pending" ? "mst-inProgress" : "mst-pending"}`}>{r.status}</span>
                <span className="form-hint">{r.id}{r.orderCode ? ` · ${r.orderCode}` : ""}</span>
              </div>
              <h3 style={{ margin: "8px 0 2px" }}>“{r.quote}”</h3>
              <p className="spec"><Stars value={r.rating} /> {r.rating} · {r.name}{r.location ? ` · ${r.location}` : ""}</p>
              {r.body && <p className="form-hint">{r.body}</p>}
              <div className="row-actions" style={{ marginTop: 10 }}>
                <button className="button secondary small" disabled={busy} onClick={() => openDraft({ ...EMPTY, ...r })}>{c.edit}</button>
                {r.status !== "published"
                  ? <button className="button secondary small" disabled={busy} onClick={() => setStatus(r.id, "published")}>{c.publish}</button>
                  : <button className="button secondary small" disabled={busy} onClick={() => setStatus(r.id, "hidden")}>{c.hide}</button>}
                <button className="button danger small" disabled={busy} onClick={() => remove(r.id)}>{c.del}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
