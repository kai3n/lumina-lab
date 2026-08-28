// S3-compatible media service (Tencent COS or Cloudflare R2). The server only
// issues short-lived PUT URLs; browsers upload directly to object storage.
import { randomBytes } from "node:crypto";
import { dirname, extname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { lstat, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { GetObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "./errors.js";

const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
]);
const MAX_BYTES = 100 * 1024 * 1024; // 100MB (이미지 상한)
const VIDEO_MAX_BYTES = 30 * 1024 * 1024; // 일반 업로드/채팅 기본 상한
const SIGN_TTL_SECONDS = 60 * 10;
const DEFAULT_LOCAL_MEDIA_ROOT = join(tmpdir(), "belovediamond-media");
const DEFAULT_LOCAL_MEDIA_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOCAL_MEDIA_MAX_BYTES = 512 * 1024 * 1024;
const pendingLocalUploads = new Map();
const localMediaFiles = new Map();
let localMediaInitPromise = null;
let initializedLocalRoot = null;
let storedLocalBytes = 0;

const TYPE_BY_EXT = new Map([...ALLOWED_TYPES].map(([type, ext]) => [`.${ext}`, type]));

function localMediaRoot(env = process.env) {
  return env.LOCAL_MEDIA_ROOT || DEFAULT_LOCAL_MEDIA_ROOT;
}

function positiveEnvNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function localMediaRetentionMs(env = process.env) {
  return positiveEnvNumber(env.LOCAL_MEDIA_RETENTION_MS, DEFAULT_LOCAL_MEDIA_RETENTION_MS);
}

function localMediaMaxBytes(env = process.env) {
  return positiveEnvNumber(env.LOCAL_MEDIA_MAX_BYTES, DEFAULT_LOCAL_MEDIA_MAX_BYTES);
}

export function r2Configured(env = process.env) {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && env.R2_PUBLIC_URL);
}

export function cosConfigured(env = process.env) {
  return Boolean(env.COS_REGION && env.COS_ACCESS_KEY_ID && env.COS_SECRET_ACCESS_KEY
    && env.COS_BUCKET && env.COS_PUBLIC_URL);
}

export function localMediaEnabled(env = process.env) {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production";
}

export function mediaProvider(env = process.env) {
  // COS credentials are also used by the private vendor workflow. Never let
  // their mere presence silently select COS for public/general media again.
  // A public COS deployment must opt in and uses the stable signed-read
  // gateway below; the vendor route passes its provider explicitly.
  if (env.MEDIA_PROVIDER) {
    if (env.MEDIA_PROVIDER === "cos") return cosConfigured(env) ? "cos" : null;
    if (env.MEDIA_PROVIDER === "r2") return r2Configured(env) ? "r2" : null;
    return null;
  }
  if (r2Configured(env)) return "r2";
  if (localMediaEnabled(env)) return "local";
  return null;
}

let _client;
let _clientKey;

function cloudConfig(env = process.env, preferredProvider = null) {
  const provider = preferredProvider || mediaProvider(env);
  if (provider === "cos") {
    if (!cosConfigured(env)) return null;
    return {
      provider,
      region: env.COS_REGION,
      endpoint: env.COS_ENDPOINT || `https://cos.${env.COS_REGION}.myqcloud.com`,
      accessKeyId: env.COS_ACCESS_KEY_ID,
      secretAccessKey: env.COS_SECRET_ACCESS_KEY,
      bucket: env.COS_BUCKET,
      publicUrl: env.COS_PUBLIC_URL,
    };
  }
  if (provider === "r2") {
    if (!r2Configured(env)) return null;
    return {
      provider,
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      publicUrl: env.R2_PUBLIC_URL,
    };
  }
  return null;
}

function client(config) {
  const key = JSON.stringify([config.provider, config.region, config.endpoint, config.accessKeyId]);
  if (!_client || _clientKey !== key) {
    _client = new S3Client({
      region: config.region,
      // 브라우저 직접 PUT과 호환: SDK 기본 체크섬 서명이 URL에 박히면
      // 클라이언트가 같은 체크섬을 못 보내 업로드가 거부된다.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    _clientKey = key;
  }
  return _client;
}

// scope: 업로드 용도별 키 프리픽스 (경로 추측 방지를 위해 랜덤 토큰 포함)
const SCOPES = new Set(["reference", "review", "proposal", "cad", "qc", "style", "chat", "hero"]);

export function isPublicMediaKey(value) {
  const key = String(value || "");
  const parts = key.split("/");
  if (parts.length !== 3 || !SCOPES.has(parts[0])) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) return false;
  if (!/^[a-f0-9]{24}\.[a-z0-9]+$/.test(parts[2])) return false;
  return TYPE_BY_EXT.has(extname(parts[2]).toLowerCase()) && key.length <= 160;
}

function mediaReadPath(key, provider = "cos") {
  if (provider !== "cos" || !isPublicMediaKey(key)) {
    throw new ApiError("VALIDATION_ERROR", 400, "bad public media key");
  }
  return `/v1/media/read/${provider}/${key}`;
}

export function publicMediaReadUrl(key, origin) {
  const path = mediaReadPath(key);
  return origin ? `${safeOrigin(origin)}${path}` : path;
}

function keyFromConfiguredBase(src, base) {
  if (!base) return null;
  try {
    const source = new URL(src);
    const configured = new URL(base);
    if (source.origin !== configured.origin || source.search || source.hash) return null;
    const basePath = configured.pathname.replace(/\/$/, "");
    if (!source.pathname.startsWith(`${basePath}/`)) return null;
    const key = decodeURIComponent(source.pathname.slice(basePath.length + 1));
    return isPublicMediaKey(key) ? key : null;
  } catch {
    return null;
  }
}

function keyFromSameOriginMediaPath(src, env = process.env) {
  try {
    const isRelative = /^\/(?!\/)/.test(String(src || ""));
    const canonical = env.PUBLIC_ORIGIN ? safeOrigin(env.PUBLIC_ORIGIN) : null;
    const source = new URL(src, canonical || "http://local.invalid");
    if (!isRelative && (!canonical || source.origin !== canonical)) return null;
    const prefixes = ["/v1/media/read/cos/", "/v1/media/local/"];
    const prefix = prefixes.find((candidate) => source.pathname.startsWith(candidate));
    if (!prefix || source.search || source.hash) return null;
    if (prefix === "/v1/media/local/" && !localMediaEnabled(env)) return null;
    const key = decodeURIComponent(source.pathname.slice(prefix.length));
    return isPublicMediaKey(key) ? key : null;
  } catch {
    return null;
  }
}

// Convert only legacy unsigned URLs from the configured private COS origin.
// Other origins and every vendor/* key remain byte-for-byte unchanged.
export function readableMediaUrl(src, env = process.env) {
  if (typeof src !== "string") return src;
  const key = keyFromConfiguredBase(src, env.COS_PUBLIC_URL);
  return key ? publicMediaReadUrl(key, env.PUBLIC_ORIGIN) : src;
}

export function isTrustedPublicMediaUrl(src, { scope, env = process.env } = {}) {
  const key = keyFromSameOriginMediaPath(src, env)
    || keyFromConfiguredBase(src, env.R2_PUBLIC_URL)
    || keyFromConfiguredBase(src, env.COS_PUBLIC_URL);
  return Boolean(key && (!scope || key.startsWith(`${scope}/`)));
}

function validateUploadInput({ scope, contentType, size, videoMaxBytes = VIDEO_MAX_BYTES }) {
  if (!SCOPES.has(scope)) throw new ApiError("VALIDATION_ERROR", 400, "bad scope");
  const ct = String(contentType || "").toLowerCase();
  const ext = ALLOWED_TYPES.get(ct);
  if (!ext) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", 400);
  const bytes = Number(size);
  const cap = ct.startsWith("video/") ? videoMaxBytes : MAX_BYTES;
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > cap) {
    throw new ApiError("MEDIA_TOO_LARGE", 400);
  }
  return { ext, bytes, contentType: String(contentType).toLowerCase() };
}

function validatedKeyPrefix(value) {
  if (value == null || value === "") return "";
  const prefix = String(value);
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(prefix) || prefix.length > 120) {
    throw new ApiError("VALIDATION_ERROR", 400, "bad key prefix");
  }
  return prefix;
}

function safeOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
    return parsed.origin;
  } catch {
    throw new ApiError("MEDIA_NOT_CONFIGURED", 503, "local media origin unavailable");
  }
}

async function walkLocalFiles(root, dir = root) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkLocalFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function initializeLocalMedia() {
  const root = localMediaRoot();
  if (initializedLocalRoot !== root) {
    pendingLocalUploads.clear();
    localMediaFiles.clear();
    storedLocalBytes = 0;
    initializedLocalRoot = root;
    localMediaInitPromise = null;
  }
  if (!localMediaInitPromise) {
    localMediaInitPromise = (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const now = Date.now();
      const retentionMs = localMediaRetentionMs();
      for (const path of await walkLocalFiles(root)) {
        let info;
        try { info = await lstat(path); } catch { continue; }
        if (!info.isFile()) continue;
        if (info.mtimeMs + retentionMs <= now) {
          await unlink(path).catch(() => {});
          continue;
        }
        const key = relative(root, path).split(sep).join("/");
        const contentType = TYPE_BY_EXT.get(extname(path).toLowerCase());
        if (!contentType) continue;
        localMediaFiles.set(key, {
          path,
          contentType,
          bytes: info.size,
          expiresAt: info.mtimeMs + retentionMs,
        });
        storedLocalBytes += info.size;
      }
      // A previous unbounded build may have left more data than the current
      // cap. Reconcile oldest files first so the cap is a disk bound, not only
      // a guard on future reservations.
      if (storedLocalBytes > localMediaMaxBytes()) {
        const oldestFirst = [...localMediaFiles.entries()]
          .sort(([, a], [, b]) => a.expiresAt - b.expiresAt);
        for (const [key, media] of oldestFirst) {
          if (storedLocalBytes <= localMediaMaxBytes()) break;
          localMediaFiles.delete(key);
          storedLocalBytes = Math.max(0, storedLocalBytes - media.bytes);
          await unlink(media.path).catch(() => {});
        }
      }
    })().catch((error) => {
      localMediaInitPromise = null;
      throw error;
    });
  }
  await localMediaInitPromise;
}

async function cleanupLocalMedia(now = Date.now()) {
  for (const [token, upload] of pendingLocalUploads) {
    if (upload.status === "pending" && upload.expiresAt <= now) pendingLocalUploads.delete(token);
    else if (upload.status === "stored" && upload.expiresAt <= now) pendingLocalUploads.delete(token);
  }
  for (const [key, media] of localMediaFiles) {
    if (media.expiresAt > now) continue;
    localMediaFiles.delete(key);
    storedLocalBytes = Math.max(0, storedLocalBytes - media.bytes);
    await unlink(media.path).catch(() => {});
  }
}

function reservedLocalBytes() {
  let total = 0;
  for (const upload of pendingLocalUploads.values()) {
    if (upload.status !== "stored") total += upload.bytes;
  }
  return total;
}

async function createLocalUploadUrl({ scope, contentType, ext, bytes, origin }) {
  await initializeLocalMedia();
  await cleanupLocalMedia();
  if (storedLocalBytes + reservedLocalBytes() + bytes > localMediaMaxBytes()) {
    throw new ApiError("MEDIA_TOO_LARGE", 507, "local media capacity reached");
  }
  const token = randomBytes(32).toString("hex");
  const key = `${scope}/${new Date().toISOString().slice(0, 10)}/${randomBytes(12).toString("hex")}.${ext}`;
  pendingLocalUploads.set(token, {
    key,
    contentType,
    bytes,
    expiresAt: Date.now() + SIGN_TTL_SECONDS * 1000,
    status: "pending",
  });
  const base = safeOrigin(origin);
  return {
    uploadUrl: `${base}/v1/media/local-upload/${token}`,
    // Chat persistence has no request-origin context, so its local URL stays
    // relative and is intrinsically bound to this app. Other dev workflows
    // retain the historical absolute URL expected by their submission gates.
    publicUrl: scope === "chat" ? `/v1/media/local/${key}` : `${base}/v1/media/local/${key}`,
    key,
    provider: "local",
    expiresIn: SIGN_TTL_SECONDS,
  };
}

export async function createUploadUrl({ scope, contentType, size, origin, keyPrefix, provider, videoMaxBytes }) {
  const validated = validateUploadInput({ scope, contentType, size, videoMaxBytes });
  const prefix = validatedKeyPrefix(keyPrefix);
  const config = cloudConfig(process.env, provider);
  if (!config) {
    if (!localMediaEnabled()) throw new ApiError("MEDIA_NOT_CONFIGURED", 503);
    return createLocalUploadUrl({ scope, origin, ...validated });
  }
  const { ext, bytes } = validated;
  const key = `${prefix ? `${prefix}/` : ""}${scope}/${new Date().toISOString().slice(0, 10)}/${randomBytes(12).toString("hex")}.${ext}`;
  // ContentLength를 서명에 포함 — presigned PUT이 정확히 이 바이트 수만 허용한다.
  // 이게 없으면 클라이언트가 선언한 size와 무관하게 임의 크기(수 GB)를 올릴 수 있어
  // MAX_BYTES 검사가 무의미해진다 (비인증 스토리지/대역폭 비용 DoS). 브라우저는
  // 본문 PUT 시 Content-Length를 항상 보내므로 정상 업로드에는 영향이 없다.
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: bytes,
  });
  const uploadUrl = await getSignedUrl(client(config), command, {
    expiresIn: SIGN_TTL_SECONDS,
    unhoistableHeaders: new Set(["content-length"]),
  });
  // Explicit provider/prefix uploads are private vendor objects represented by
  // key+provider. Public COS objects instead persist a stable first-party URL;
  // that endpoint mints a fresh short-lived GET signature on every read.
  const privateUpload = Boolean(provider || prefix);
  const publicUrl = privateUpload
    ? null
    : config.provider === "cos"
      ? publicMediaReadUrl(key, origin)
      : `${config.publicUrl.replace(/\/$/, "")}/${key}`;
  return { uploadUrl, publicUrl, key, provider: config.provider, expiresIn: SIGN_TTL_SECONDS };
}

export async function createReadUrl({ key, provider, expiresIn = SIGN_TTL_SECONDS }) {
  const normalizedKey = String(key || "");
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\/[a-f0-9]{24}\.[a-z0-9]+$/.test(normalizedKey)
    || normalizedKey.length > 512) {
    throw new ApiError("VALIDATION_ERROR", 400, "bad media key");
  }
  const config = cloudConfig(process.env, provider);
  if (!config) throw new ApiError("MEDIA_NOT_CONFIGURED", 503);
  const command = new GetObjectCommand({ Bucket: config.bucket, Key: normalizedKey });
  return getSignedUrl(client(config), command, { expiresIn });
}

// non-production 전용 1회 PUT. 토큰에 서명된 타입/바이트 수와 정확히 일치한
// 바디만 temp 디렉터리에 원자적으로 생성하고, 성공 뒤 같은 토큰은 재사용 불가다.
export async function consumeLocalUpload({ token, contentType, body }) {
  if (!localMediaEnabled()) throw new ApiError("NOT_FOUND", 404);
  await initializeLocalMedia();
  await cleanupLocalMedia();
  const upload = pendingLocalUploads.get(token);
  if (!upload) throw new ApiError("UPLOAD_SESSION_EXPIRED", 410);
  if (upload.status !== "pending") throw new ApiError("UPLOAD_SESSION_EXPIRED", 410, "upload token already used");
  if (!Buffer.isBuffer(body)) throw new ApiError("VALIDATION_ERROR", 400, "binary body required");
  const actualType = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  if (actualType !== upload.contentType) throw new ApiError("VALIDATION_ERROR", 400, "content type mismatch");
  if (body.length !== upload.bytes) throw new ApiError("VALIDATION_ERROR", 400, "content length mismatch");

  // Claim the token synchronously before the first await. Two concurrent PUTs
  // otherwise both observe used=false and race at writeFile, leaking EEXIST as
  // a 500 even though the token is documented as single-use.
  upload.status = "writing";
  const path = join(localMediaRoot(), upload.key);
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, body, { flag: "wx", mode: 0o600 });
  } catch (error) {
    pendingLocalUploads.delete(token);
    await unlink(path).catch(() => {});
    throw error;
  }
  upload.status = "stored";
  const expiresAt = Date.now() + localMediaRetentionMs();
  storedLocalBytes += upload.bytes;
  localMediaFiles.set(upload.key, { path, contentType: upload.contentType, bytes: upload.bytes, expiresAt });
  return { key: upload.key };
}

export async function getLocalMedia(key) {
  if (!localMediaEnabled() || typeof key !== "string") return null;
  await initializeLocalMedia();
  await cleanupLocalMedia();
  return localMediaFiles.get(key) || null;
}

// Test helper: emulate a process restart while intentionally keeping files on
// disk. The next operation must discover/reconcile them from LOCAL_MEDIA_ROOT.
export function __resetLocalMediaStateForTests() {
  pendingLocalUploads.clear();
  localMediaFiles.clear();
  storedLocalBytes = 0;
  localMediaInitPromise = null;
  initializedLocalRoot = null;
}
