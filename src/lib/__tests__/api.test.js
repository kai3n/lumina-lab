import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, uploadMedia, ApiUnavailableError, ApiRequestError } from "../api.js";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

describe("apiFetch — 서버 부재/오류 계약", () => {
  it("네트워크 실패는 ApiUnavailableError (정적 데모 폴백 신호)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("/media/upload-url", { method: "POST", body: {} }))
      .rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("에러 코드가 있는 실패 응답은 ApiRequestError로 코드 전달", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "MEDIA_TOO_LARGE" } }, 400),
    ));
    const err = await apiFetch("/media/upload-url", { method: "POST", body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("MEDIA_TOO_LARGE");
  });
});

describe("uploadMedia — presigned R2 직행 업로드", () => {
  it("서명 URL 발급 → PUT 업로드 → publicUrl 반환", async () => {
    const blob = new Blob(["fake-jpeg"], { type: "image/jpeg" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        uploadUrl: "https://r2.example/signed",
        publicUrl: "https://pub.example/reference/2026-07-02/abc.jpg",
      }, 201))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const publicUrl = await uploadMedia(blob, { scope: "reference", contentType: "image/jpeg" });

    expect(publicUrl).toBe("https://pub.example/reference/2026-07-02/abc.jpg");
    const [signCall, putCall] = fetchMock.mock.calls;
    expect(signCall[0]).toBe("/v1/media/upload-url");
    expect(JSON.parse(signCall[1].body)).toEqual({ scope: "reference", contentType: "image/jpeg", size: blob.size });
    expect(putCall[0]).toBe("https://r2.example/signed");
    expect(putCall[1]).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
  });

  it("개발용 same-origin 상대 publicUrl도 영구 미디어 계약으로 허용한다", async () => {
    const blob = new Blob(["local"], { type: "image/jpeg" });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        uploadUrl: "http://127.0.0.1:8787/v1/media/local-upload/token",
        publicUrl: "/v1/media/local/review/2026-08-27/0123456789abcdef01234567.jpg",
      }, 201))
      .mockResolvedValueOnce({ ok: true, status: 204 }));
    await expect(uploadMedia(blob, { scope: "review", contentType: "image/jpeg" }))
      .resolves.toBe("/v1/media/local/review/2026-08-27/0123456789abcdef01234567.jpg");
  });

  it("서버 부재(발급 실패)는 ApiUnavailableError 전파 — 호출부 로컬 폴백 신호", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(uploadMedia(new Blob(["x"]), { scope: "reference", contentType: "image/jpeg" }))
      .rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("PUT 실패(네트워크·비2xx)는 UPLOAD_FAILED", async () => {
    const signed = jsonResponse({ ok: true, uploadUrl: "https://r2.example/signed", publicUrl: "https://pub.example/x.jpg" }, 201);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(signed)
      .mockRejectedValueOnce(new TypeError("network")));
    let err = await uploadMedia(new Blob(["x"]), { scope: "review", contentType: "image/jpeg" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("UPLOAD_FAILED");

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, uploadUrl: "https://r2.example/signed", publicUrl: "https://pub.example/x.jpg" }, 201))
      .mockResolvedValueOnce({ ok: false, status: 403 }));
    err = await uploadMedia(new Blob(["x"]), { scope: "review", contentType: "image/jpeg" }).catch((e) => e);
    expect(err.code).toBe("UPLOAD_FAILED");
    expect(err.status).toBe(403);
  });

  it("서버가 유효한 http(s) uploadUrl/publicUrl 계약을 주지 않으면 PUT 전에 실패한다", async () => {
    const blob = new Blob(["x"], { type: "image/jpeg" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, uploadUrl: "javascript:alert(1)", publicUrl: "data:image/jpeg,x" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const err = await uploadMedia(blob, { scope: "review", contentType: "image/jpeg" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("INVALID_UPLOAD_RESPONSE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
