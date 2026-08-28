// 리뷰 작성 — 미디어 퍼스트: 인증샷부터, 별점, 한 줄. 포털/전용 페이지 공용.
import { useState } from "react";
import { MediaPicker } from "./ui.jsx";
import { submitReview } from "../lib/store.js";
import { track } from "../lib/track.js";

// submit prop이 있으면 그쪽(실서버 API)으로, 없으면 레거시 데모 스토어로 제출
export default function ReviewForm({ orderId, rc, onDone, submit: submitOverride }) {
  const [media, setMedia] = useState([]);
  const [rating, setRating] = useState(5);
  const [quote, setQuote] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const serverBacked = Boolean(submitOverride);
  const submitBlocked = busy || pickerBusy || (serverBacked && Boolean(pickerError));
  async function submit() {
    if (!quote.trim() || submitBlocked) return;
    setBusy(true);
    setError("");
    try {
      if (submitOverride) await submitOverride({ rating, quote, body, media });
      else submitReview(orderId, { rating, quote, body, media });
      track("review_submit", { meta: { rating } });
      onDone?.();
    } catch {
      setError(rc.error || "Could not submit — please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack review-form">
      <div className="field"><span>{rc.mediaLbl}</span>
        <MediaPicker
          value={media}
          onChange={setMedia}
          maxItems={5}
          showSamples={false}
          previewMode="list"
          scope="review"
          remoteRequired={serverBacked}
          onBusyChange={setPickerBusy}
          onErrorChange={setPickerError}
        />
      </div>
      <div className="field"><span>{rc.rating}</span>
        <div className="review-stars" role="radiogroup" aria-label={rc.rating}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span className="rs-star" key={n}>
              <span aria-hidden="true">★</span>
              <span className="rs-fill" aria-hidden="true" style={{ width: `${Math.max(0, Math.min(1, rating - n + 1)) * 100}%` }}>★</span>
              <button type="button" className="rs-half" role="radio" aria-checked={rating === n - 0.5} aria-label={`${n - 0.5}`} onClick={() => setRating(n - 0.5)} />
              <button type="button" className="rs-full" role="radio" aria-checked={rating === n} aria-label={`${n}`} onClick={() => setRating(n)} />
            </span>
          ))}
          <span className="rs-value">{rating.toFixed(1)}</span>
        </div>
      </div>
      <label className="field"><span>{rc.quoteLbl}</span>
        <input value={quote} placeholder={rc.quotePh} onChange={(e) => setQuote(e.target.value)} />
      </label>
      <label className="field"><span>{rc.bodyLbl}</span>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <p className="form-hint">{rc.note}</p>
      {error && <p className="form-error">{error}</p>}
      <button className="button primary" type="button" disabled={!quote.trim() || submitBlocked} onClick={submit}>{rc.submit}</button>
    </div>
  );
}
