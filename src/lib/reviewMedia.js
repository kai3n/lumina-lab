const HTTP_URL = /^https?:\/\//i;
const ROOT_RELATIVE_URL = /^\/(?!\/)/;

export function isPersistedReviewMediaUrl(value, { allowRootRelative = false } = {}) {
  const src = String(value || "");
  return HTTP_URL.test(src) || (allowRootRelative && ROOT_RELATIVE_URL.test(src));
}

function reviewMediaError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Server-backed review submissions are all-or-nothing. Never silently filter a
// failed data:/blob: preview into a successful text-only review.
export function buildReviewMediaPayload(media, { allowRootRelative = false, maxItems = 5 } = {}) {
  if (!Array.isArray(media)) return [];
  if (media.length > maxItems) throw reviewMediaError("REVIEW_MEDIA_LIMIT");
  return media.map((item) => {
    if (!item || !isPersistedReviewMediaUrl(item.src, { allowRootRelative }) || item.transient) {
      throw reviewMediaError("REVIEW_MEDIA_NOT_UPLOADED");
    }
    if (item.poster && !isPersistedReviewMediaUrl(item.poster, { allowRootRelative })) {
      throw reviewMediaError("REVIEW_MEDIA_NOT_UPLOADED");
    }
    return {
      kind: item.kind === "video" ? "video" : "image",
      src: item.src,
      ...(item.poster ? { poster: item.poster } : {}),
    };
  });
}
