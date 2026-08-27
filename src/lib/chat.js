// 라이브챗 클라이언트 — same-origin /v1/chat. 서버 부재(정적 데모)면 apiFetch가 던지고
// 위젯은 조용히 접힌 상태를 유지한다.
import { apiFetch } from "./api.js";

export async function sendChatMessage({ body, attachments, locale, email } = {}) {
  return apiFetch("/chat/messages", { method: "POST", body: { body, attachments, locale, email } });
}

// peek=true → 서버가 읽음/last_seen을 갱신하지 않는다(닫힌 버블의 미확인 뱃지 폴링용).
export async function fetchThread({ since = 0, peek = false } = {}) {
  const q = new URLSearchParams();
  if (since) q.set("since", String(since));
  if (peek) q.set("peek", "1");
  const qs = q.toString();
  return apiFetch(`/chat/thread${qs ? `?${qs}` : ""}`);
}

export async function closeChatThread() {
  return apiFetch("/chat/close", { method: "POST", body: {} });
}

// 오프라인 이메일 답장용 주소만 저장 (메시지 없이도)
export async function saveChatEmail(email, locale) {
  return apiFetch("/chat/email", { method: "POST", body: { email, locale } });
}

// 예약 가능한 20분 슬롯(UTC ISO 배열)
export async function fetchConsultationSlots() {
  return apiFetch("/chat/consultation/slots");
}

// 화상 상담 예약 — 슬롯 확정(slot=UTC ISO, tz=방문자 타임존)
export async function bookConsultation({ name, contact, note, slot, tz, locale } = {}) {
  return apiFetch("/chat/consultation", { method: "POST", body: { name, contact, note, slot, tz, locale } });
}

// CSAT 평점 제출 (1~5)
export async function submitCsat(rating) {
  return apiFetch("/chat/csat", { method: "POST", body: { rating } });
}

// 서버 media.js ALLOWED_TYPES와 정렬 — 이미지·영상만 첨부 허용.
export const CHAT_MAX_BYTES = 100 * 1024 * 1024;       // 이미지 상한
export const CHAT_VIDEO_MAX_BYTES = 30 * 1024 * 1024;  // 영상 상한 30MB

// File/DataTransfer 목록에서 이미지·영상 파일만 골라낸다(드래그앤드롭·붙여넣기·파일선택 공용).
export function chatMediaFiles(list) {
  return Array.from(list || []).filter(
    (f) => f && typeof f.type === "string" && (f.type.startsWith("image/") || f.type.startsWith("video/")),
  );
}

// 채팅 미디어 — /chat/upload-url presigned 발급 후 R2로 직행 PUT, 영구 URL 반환. 이미지·영상 공용.
export async function uploadChatImage(blob, contentType) {
  const { uploadUrl, publicUrl } = await apiFetch("/chat/upload-url", {
    method: "POST",
    body: { contentType, size: blob.size },
  });
  if (!/^https?:\/\//i.test(String(uploadUrl || ""))
    || !/^(https?:\/\/|\/(?!\/))/i.test(String(publicUrl || ""))) {
    throw new Error("INVALID_UPLOAD_RESPONSE");
  }
  const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!res.ok) throw new Error("UPLOAD_FAILED");
  return publicUrl;
}
