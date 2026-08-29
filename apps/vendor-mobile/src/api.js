const API_BASE = (import.meta.env.VITE_VENDOR_API_URL || "").replace(/\/$/, "");
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== "false";

export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch(path, { method = "GET", body, headers } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK_UNAVAILABLE");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error?.code || "REQUEST_FAILED", response.status);
  return data;
}

// The server only signs the request; the phone uploads directly to object storage with PUT.
export async function uploadVendorMedia(file, jobCode, purpose) {
  const signed = await apiFetch(`/vendor/orders/${encodeURIComponent(jobCode)}/media/upload-url`, {
    method: "POST",
    body: { purpose, fileName: file.name, contentType: file.type, size: file.size },
  });
  const uploaded = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!uploaded.ok) throw new ApiError("UPLOAD_FAILED", uploaded.status);
  const completed = await apiFetch(
    `/vendor/orders/${encodeURIComponent(jobCode)}/media/${encodeURIComponent(signed.mediaId)}/complete`,
    { method: "POST" },
  );
  return completed.media;
}

export const vendorApi = {
  login: (email, password) => apiFetch("/vendor/auth/password", { method: "POST", body: { email, password } }),
  acceptInvite: (token, password) => apiFetch("/vendor/auth/accept-invite", { method: "POST", body: { token, password } }),
  requestPasswordReset: (email) => apiFetch("/vendor/auth/password-reset/request", { method: "POST", body: { email } }),
  confirmPasswordReset: (token, password) => apiFetch("/vendor/auth/password-reset/confirm", { method: "POST", body: { token, password } }),
  logout: () => apiFetch("/vendor/auth/logout", { method: "POST" }),
  me: () => apiFetch("/vendor/me"),
  orders: (status = "") => apiFetch(`/vendor/orders${status ? `?status=${status}` : ""}`),
  order: (code) => apiFetch(`/vendor/orders/${encodeURIComponent(code)}`),
  addUpdate: (code, payload) => apiFetch(`/vendor/orders/${encodeURIComponent(code)}/updates`, { method: "POST", body: payload }),
  changeStage: (code, payload) => apiFetch(`/vendor/orders/${encodeURIComponent(code)}/stage`, { method: "POST", body: payload }),
  inventory: () => apiFetch("/vendor/inventory"),
  saveStone: (stone) => apiFetch(stone.id ? `/vendor/inventory/${stone.id}` : "/vendor/inventory", { method: stone.id ? "PATCH" : "POST", body: stone }),
};
