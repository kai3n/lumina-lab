import express, { Router } from "express";
import { ApiError } from "./errors.js";
import { rateLimit } from "./rateLimit.js";
import {
  createReadUrl,
  createUploadUrl,
  consumeLocalUpload,
  getLocalMedia,
  isPublicMediaKey,
  mediaProvider,
} from "./media.js";

const MINUTE = 60 * 1000;

function requestOrigin(req) {
  return process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`;
}

const localUploadBody = express.raw({ type: () => true, limit: "100mb" });
function parseLocalUpload(req, res, next) {
  localUploadBody(req, res, (error) => {
    if (error?.type === "entity.too.large") return next(new ApiError("MEDIA_TOO_LARGE", 413));
    return next(error);
  });
}

export function mediaRouter() {
  const r = Router();

  // presigned 업로드 URL 발급 — 익명 인테이크 레퍼런스도 허용하되 타이트하게 제한.
  // 실제 파일은 브라우저 → R2 직행이라 서버 대역폭·바디 제한과 무관하다.
  r.post("/upload-url",
    rateLimit({ limit: 20, windowMs: MINUTE }),
    async (req, res, next) => {
    try {
      const { scope, contentType, size } = req.body || {};
      if (typeof scope !== "string" || typeof contentType !== "string") {
        throw new ApiError("VALIDATION_ERROR", 400);
      }
      const signed = await createUploadUrl({ scope, contentType, size, origin: requestOrigin(req) });
      res.status(201).json({ ok: true, ...signed });
    } catch (e) { next(e); }
  });

  // R2가 없는 dev/test 전용 업로드 provider. 발급된 256-bit 토큰은 한 번만
  // 사용할 수 있고, 발급 당시 MIME/바이트 수와 정확히 일치해야 한다.
  r.put("/local-upload/:token",
    rateLimit({ limit: 60, windowMs: MINUTE, keyFn: (req) => `local-media-put:${req.ip}` }),
    parseLocalUpload,
    async (req, res, next) => {
      try {
        await consumeLocalUpload({
          token: req.params.token,
          contentType: req.get("content-type"),
          body: req.body,
        });
        res.status(204).end();
      } catch (e) { next(e); }
    });

  r.get("/local/*", async (req, res, next) => {
    try {
      const key = String(req.params[0] || "");
      const media = await getLocalMedia(key);
      if (!media) return next(new ApiError("NOT_FOUND", 404));
      res.set({
        "Content-Type": media.contentType,
        "Content-Length": String(media.bytes),
        "Cache-Control": "public, max-age=3600, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      return res.sendFile(media.path, (error) => { if (error) next(error); });
    } catch (error) { return next(error); }
  });

  // Stable URL for general media stored in a private COS bucket. The random
  // 96-bit object key remains the bearer capability just as it was with R2,
  // while vendor/* can never match this three-segment public-key contract.
  // Never cache the redirect itself: its target signature expires in 10 min.
  r.get("/read/cos/:scope/:date/:file",
    rateLimit({ limit: 300, windowMs: MINUTE, keyFn: (req) => `media-read:${req.ip}` }),
    async (req, res, next) => {
      try {
        const key = `${req.params.scope}/${req.params.date}/${req.params.file}`;
        if (!isPublicMediaKey(key)) return next(new ApiError("NOT_FOUND", 404));
        const signed = await createReadUrl({ key, provider: "cos" });
        res.set({
          "Cache-Control": "private, no-store, max-age=0",
          "CDN-Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        });
        return res.redirect(302, signed);
      } catch (error) { return next(error); }
    });

  r.get("/status", (_req, res) => {
    const provider = mediaProvider();
    res.json({ configured: Boolean(provider), provider });
  });

  return r;
}
