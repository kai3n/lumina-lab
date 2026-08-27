import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { access, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../app.js";
import { __resetRateLimit } from "../rateLimit.js";
import {
  __resetLocalMediaStateForTests,
  createReadUrl,
  createUploadUrl,
  isTrustedPublicMediaUrl,
  readableMediaUrl,
} from "../media.js";

const app = createApp();
const R2_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"];
const COS_KEYS = ["COS_REGION", "COS_ACCESS_KEY_ID", "COS_SECRET_ACCESS_KEY", "COS_BUCKET", "COS_ENDPOINT", "COS_PUBLIC_URL"];
let localRoot;
beforeEach(async () => {
  __resetRateLimit();
  __resetLocalMediaStateForTests();
  for (const key of R2_KEYS) delete process.env[key];
  for (const key of COS_KEYS) delete process.env[key];
  delete process.env.MEDIA_PROVIDER;
  delete process.env.PUBLIC_ORIGIN;
  delete process.env.LOCAL_MEDIA_MAX_BYTES;
  delete process.env.LOCAL_MEDIA_RETENTION_MS;
  localRoot = await mkdtemp(join(tmpdir(), "beloved-media-test-"));
  process.env.LOCAL_MEDIA_ROOT = localRoot;
  process.env.NODE_ENV = "test";
});

afterEach(async () => {
  __resetLocalMediaStateForTests();
  delete process.env.LOCAL_MEDIA_ROOT;
  delete process.env.LOCAL_MEDIA_MAX_BYTES;
  delete process.env.LOCAL_MEDIA_RETENTION_MS;
  if (localRoot) await rm(localRoot, { recursive: true, force: true });
});

describe("미디어 presigned 업로드", () => {
  it("production에서 R2 미설정 시 503 MEDIA_NOT_CONFIGURED", async () => {
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).post("/v1/media/upload-url")
        .send({ scope: "review", contentType: "image/jpeg", size: 1000 });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("MEDIA_NOT_CONFIGURED");
      expect((await request(app).get("/v1/media/status")).body).toEqual({ configured: false, provider: null });
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  it("non-production local provider는 1회 PUT 뒤 영구 http URL로 같은 바이트를 제공한다", async () => {
    const bytes = Buffer.from("local-media-roundtrip");
    const signed = await request(app).post("/v1/media/upload-url")
      .send({ scope: "qc", contentType: "image/jpeg", size: bytes.length });
    expect(signed.status).toBe(201);
    expect(signed.body.uploadUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/media\/local-upload\/[a-f0-9]{64}$/);
    expect(signed.body.publicUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/media\/local\/qc\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{24}\.jpg$/);
    expect((await request(app).get(new URL(signed.body.publicUrl).pathname)).status).toBe(404);

    const uploadPath = new URL(signed.body.uploadUrl).pathname;
    const uploaded = await request(app).put(uploadPath).set("Content-Type", "image/jpeg").send(bytes);
    expect(uploaded.status).toBe(204);
    const reused = await request(app).put(uploadPath).set("Content-Type", "image/jpeg").send(bytes);
    expect(reused.status).toBe(410);

    const publicFile = await request(app).get(new URL(signed.body.publicUrl).pathname);
    expect(publicFile.status).toBe(200);
    expect(publicFile.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(publicFile.headers["cache-control"]).toContain("immutable");
    expect(Buffer.compare(publicFile.body, bytes)).toBe(0);
    expect((await request(app).get("/v1/media/status")).body).toEqual({ configured: true, provider: "local" });
  });

  it("PUBLIC_ORIGIN 없는 로컬 개발은 same-origin 상대 chat URL만 신뢰한다", () => {
    const key = "chat/2026-08-27/0123456789abcdef01234567.jpg";
    expect(isTrustedPublicMediaUrl(`/v1/media/local/${key}`, { scope: "chat" })).toBe(true);
    expect(isTrustedPublicMediaUrl(`http://127.0.0.1:8787/v1/media/local/${key}`, { scope: "chat" })).toBe(false);
    expect(isTrustedPublicMediaUrl(`http://localhost:5173/v1/media/local/${key}`, { scope: "chat" })).toBe(false);
    expect(isTrustedPublicMediaUrl(`https://evil.example/v1/media/local/${key}`, { scope: "chat" })).toBe(false);
    expect(isTrustedPublicMediaUrl(`http://127.0.0.1:8787/v1/media/local/review/2026-08-27/0123456789abcdef01234567.jpg`, { scope: "chat" })).toBe(false);
  });

  it("로컬 chat 발급 URL은 request Host를 저장하지 않는 same-origin 상대 경로다", async () => {
    const signed = await request(app).post("/v1/media/upload-url")
      .set("Host", "192.168.10.25:8787")
      .send({ scope: "chat", contentType: "image/jpeg", size: 8 });
    expect(signed.status).toBe(201);
    expect(signed.body.uploadUrl).toMatch(/^http:\/\/192\.168\.10\.25:8787\/v1\/media\/local-upload\//);
    expect(signed.body.publicUrl).toMatch(/^\/v1\/media\/local\/chat\//);
    expect(isTrustedPublicMediaUrl(signed.body.publicUrl, { scope: "chat" })).toBe(true);
  });

  it("local PUT은 발급된 MIME과 바이트 수를 강제한다", async () => {
    const signed = await request(app).post("/v1/media/upload-url")
      .send({ scope: "reference", contentType: "image/png", size: 4 });
    const uploadPath = new URL(signed.body.uploadUrl).pathname;
    expect((await request(app).put(uploadPath).set("Content-Type", "image/jpeg").send(Buffer.alloc(4))).status).toBe(400);
    expect((await request(app).put(uploadPath).set("Content-Type", "image/png").send(Buffer.alloc(3))).status).toBe(400);
    expect((await request(app).put(uploadPath).set("Content-Type", "image/png").send(Buffer.alloc(4))).status).toBe(204);
  });

  it("동시 local PUT은 토큰을 원자적으로 한 번만 소비하고 500을 내지 않는다", async () => {
    const bytes = Buffer.from("single-use-race");
    const signed = await request(app).post("/v1/media/upload-url")
      .send({ scope: "qc", contentType: "image/jpeg", size: bytes.length });
    const uploadPath = new URL(signed.body.uploadUrl).pathname;
    const responses = await Promise.all([
      request(app).put(uploadPath).set("Content-Type", "image/jpeg").send(bytes),
      request(app).put(uploadPath).set("Content-Type", "image/jpeg").send(bytes),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 410]);
    expect(responses.find((response) => response.status === 410)?.body.error.code).toBe("UPLOAD_SESSION_EXPIRED");
  });

  it("재시작 뒤 파일을 복구하고 보존기간이 지난 orphan은 삭제한다", async () => {
    const bytes = Buffer.from("restart-persistent");
    const signed = await request(app).post("/v1/media/upload-url")
      .send({ scope: "reference", contentType: "image/png", size: bytes.length });
    const uploadPath = new URL(signed.body.uploadUrl).pathname;
    const publicPath = new URL(signed.body.publicUrl).pathname;
    await request(app).put(uploadPath).set("Content-Type", "image/png").send(bytes).expect(204);

    __resetLocalMediaStateForTests();
    const restored = await request(app).get(publicPath);
    expect(restored.status).toBe(200);
    expect(Buffer.compare(restored.body, bytes)).toBe(0);

    const key = publicPath.replace("/v1/media/local/", "");
    const diskPath = join(localRoot, ...key.split("/"));
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(diskPath, old, old);
    process.env.LOCAL_MEDIA_RETENTION_MS = String(24 * 60 * 60 * 1000);
    __resetLocalMediaStateForTests();
    expect((await request(app).get(publicPath)).status).toBe(404);
    await expect(access(diskPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("대기 중 예약과 저장 파일을 합산한 local 용량 상한을 지킨다", async () => {
    process.env.LOCAL_MEDIA_MAX_BYTES = "10";
    const first = await request(app).post("/v1/media/upload-url")
      .send({ scope: "reference", contentType: "image/jpeg", size: 6 });
    expect(first.status).toBe(201);
    const overCapacity = await request(app).post("/v1/media/upload-url")
      .send({ scope: "qc", contentType: "image/jpeg", size: 5 });
    expect(overCapacity.status).toBe(507);
    expect(overCapacity.body.error.code).toBe("MEDIA_TOO_LARGE");

    await request(app).put(new URL(first.body.uploadUrl).pathname)
      .set("Content-Type", "image/jpeg").send(Buffer.alloc(6)).expect(204);
    const exactRemaining = await request(app).post("/v1/media/upload-url")
      .send({ scope: "qc", contentType: "image/jpeg", size: 4 });
    expect(exactRemaining.status).toBe(201);
  });

  it("R2 설정 시 서명 URL 발급 + 퍼블릭 URL 매핑", async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "sec",
      R2_BUCKET: "beloved-media", R2_PUBLIC_URL: "https://pub-test.r2.dev",
    });
    try {
      const res = await request(app).post("/v1/media/upload-url")
        .send({ scope: "review", contentType: "video/mp4", size: 5_000_000 });
      expect(res.status).toBe(201);
      expect(res.body.uploadUrl).toContain("beloved-media.acc.r2.cloudflarestorage.com/review/");
      expect(res.body.uploadUrl).not.toContain("checksum"); // 브라우저 PUT 호환
      expect(res.body.publicUrl).toMatch(/^https:\/\/pub-test\.r2\.dev\/review\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{24}\.mp4$/);
      // 검증: 잘못된 타입/크기/스코프
      expect((await request(app).post("/v1/media/upload-url").send({ scope: "review", contentType: "application/pdf", size: 10 })).status).toBe(400);
      expect((await request(app).post("/v1/media/upload-url").send({ scope: "review", contentType: "image/jpeg", size: 200_000_000 })).status).toBe(400);
      expect((await request(app).post("/v1/media/upload-url").send({ scope: "hack", contentType: "image/jpeg", size: 10 })).status).toBe(400);
    } finally {
      for (const k of R2_KEYS) delete process.env[k];
    }
  });

  it("Tencent COS 일반 업로드는 안정적인 same-origin 읽기 URL을 반환하고 매 GET마다 짧게 서명한다", async () => {
    Object.assign(process.env, {
      MEDIA_PROVIDER: "cos",
      PUBLIC_ORIGIN: "https://app.delune.example",
      COS_REGION: "ap-guangzhou",
      COS_ACCESS_KEY_ID: "secret-id",
      COS_SECRET_ACCESS_KEY: "secret-key",
      COS_BUCKET: "delune-vendor-1250000000",
      COS_PUBLIC_URL: "https://media.delune.example",
    });
    try {
      const res = await request(app).post("/v1/media/upload-url")
        .send({ scope: "qc", contentType: "image/jpeg", size: 2048 });
      expect(res.status).toBe(201);
      expect(res.body.uploadUrl).toContain("delune-vendor-1250000000.cos.ap-guangzhou.myqcloud.com/qc/");
      expect(res.body.publicUrl).toMatch(/^https:\/\/app\.delune\.example\/v1\/media\/read\/cos\/qc\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{24}\.jpg$/);
      expect((await request(app).get("/v1/media/status")).body).toEqual({ configured: true, provider: "cos" });

      const read = await request(app).get(new URL(res.body.publicUrl).pathname).redirects(0);
      expect(read.status).toBe(302);
      expect(read.headers.location).toContain("delune-vendor-1250000000.cos.ap-guangzhou.myqcloud.com/qc/");
      expect(read.headers.location).toContain("X-Amz-Expires=600");
      expect(read.headers["cache-control"]).toContain("no-store");
      expect(read.headers["referrer-policy"]).toBe("no-referrer");

      const legacy = "https://media.delune.example/review/2026-08-27/0123456789abcdef01234567.jpg";
      expect(readableMediaUrl(legacy)).toBe(
        "https://app.delune.example/v1/media/read/cos/review/2026-08-27/0123456789abcdef01234567.jpg",
      );
      expect(readableMediaUrl("https://media.delune.example/vendor/42/qc/2026-08-27/0123456789abcdef01234567.mp4"))
        .toBe("https://media.delune.example/vendor/42/qc/2026-08-27/0123456789abcdef01234567.mp4");
      const readUrl = await createReadUrl({ key: "vendor/42/qc/2026-07-19/0123456789abcdef01234567.mp4", provider: "cos" });
      expect(readUrl).toContain("delune-vendor-1250000000.cos.ap-guangzhou.myqcloud.com/vendor/42/qc/");
      expect(readUrl).toContain("X-Amz-Expires=600");

      const vendorVideo = await createUploadUrl({
        scope: "qc", contentType: "video/mp4", size: 200 * 1024 * 1024,
        keyPrefix: "vendor/42", provider: "cos", videoMaxBytes: 200 * 1024 * 1024,
      });
      expect(vendorVideo.provider).toBe("cos");
      expect(vendorVideo.publicUrl).toBeNull();
      expect(vendorVideo.key).toMatch(/^vendor\/42\/qc\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{24}\.mp4$/);
      expect((await request(app).get(`/v1/media/read/cos/${vendorVideo.key}`)).status).toBe(404);
    } finally {
      for (const key of COS_KEYS) delete process.env[key];
      delete process.env.MEDIA_PROVIDER;
    }
  });

  it("COS 자격증명은 일반 미디어 provider로 암묵 선택되지 않는다", async () => {
    process.env.NODE_ENV = "production";
    Object.assign(process.env, {
      COS_REGION: "ap-guangzhou",
      COS_ACCESS_KEY_ID: "secret-id",
      COS_SECRET_ACCESS_KEY: "secret-key",
      COS_BUCKET: "delune-vendor-1250000000",
      COS_PUBLIC_URL: "https://media.delune.example",
    });
    try {
      const res = await request(app).post("/v1/media/upload-url")
        .send({ scope: "review", contentType: "image/jpeg", size: 2048 });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("MEDIA_NOT_CONFIGURED");
      expect((await request(app).get("/v1/media/status")).body).toEqual({ configured: false, provider: null });
    } finally {
      process.env.NODE_ENV = "test";
      for (const key of COS_KEYS) delete process.env[key];
    }
  });
});
