// 실서버 API 클라이언트 — same-origin /v1 (Vercel 프로덕션·vite dev 프록시 공통).
// 정적 데모(GitHub Pages)처럼 서버가 없으면 호출이 실패하고, 호출부는 데모 폴백을 탄다.
export class ApiUnavailableError extends Error {
  constructor() { super("API_UNAVAILABLE"); this.code = "API_UNAVAILABLE"; }
}

export class ApiRequestError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export async function apiFetch(path, { method = "GET", body, headers } = {}) {
  let res;
  try {
    res = await fetch(`/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(headers || {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiUnavailableError(); // 네트워크/서버 부재
  }
  let data = null;
  try { data = await res.json(); } catch { /* 비JSON 응답 */ }
  if (!res.ok) {
    // 정적 호스팅에서 /v1이 SPA로 폴백되면 JSON 계약이 아님 → 서버 부재로 간주
    if (!data?.error?.code) throw new ApiUnavailableError();
    throw new ApiRequestError(data.error.code, res.status);
  }
  return data;
}

// R2 미디어 업로드 — 서버는 presigned URL만 발급하고 파일은 브라우저→버킷 직행.
// 성공 시 영구 publicUrl 반환. 서버 부재 시 ApiUnavailableError가 그대로 전파되어
// 호출부(MediaPicker)가 base64/blob 프리뷰 폴백을 탄다.
export async function uploadMedia(blob, { scope, contentType }) {
  const { uploadUrl, publicUrl } = await apiFetch("/media/upload-url", {
    method: "POST",
    body: { scope, contentType, size: blob.size },
  });
  if (!/^https?:\/\//i.test(String(uploadUrl || ""))
    || !/^(https?:\/\/|\/(?!\/))/i.test(String(publicUrl || ""))) {
    throw new ApiRequestError("INVALID_UPLOAD_RESPONSE", 502);
  }
  let res;
  try {
    res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
  } catch {
    throw new ApiRequestError("UPLOAD_FAILED", 0);
  }
  if (!res.ok) throw new ApiRequestError("UPLOAD_FAILED", res.status);
  return publicUrl;
}
