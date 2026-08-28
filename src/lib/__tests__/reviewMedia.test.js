import { describe, expect, it } from "vitest";
import { buildReviewMediaPayload, isPersistedReviewMediaUrl } from "../reviewMedia.js";

describe("서버 리뷰 미디어 제출 계약", () => {
  it("http(s)는 허용하고 고객 제출의 루트 상대 URL은 거부한다", () => {
    expect(isPersistedReviewMediaUrl("https://belovediamond.com/v1/media/read/cos/review/2026-08-27/a.jpg")).toBe(true);
    expect(isPersistedReviewMediaUrl("http://127.0.0.1:8787/v1/media/local/review/a.jpg")).toBe(true);
    expect(isPersistedReviewMediaUrl("/assets/review.jpg")).toBe(false);
    expect(isPersistedReviewMediaUrl("/assets/review.jpg", { allowRootRelative: true })).toBe(true);
  });

  it.each(["data:image/jpeg;base64,abc", "blob:https://example.com/id", "javascript:alert(1)", "//evil.example/x.jpg", ""])(
    "transient/위험 URL %s 를 거부한다",
    (src) => expect(() => buildReviewMediaPayload([{ kind: "image", src }])).toThrow("REVIEW_MEDIA_NOT_UPLOADED"),
  );

  it("유효·무효 혼합에서 무효 항목만 조용히 버리지 않고 전체 제출을 거부한다", () => {
    expect(() => buildReviewMediaPayload([
      { kind: "image", src: "https://cdn.example/a.jpg" },
      { kind: "image", src: "data:image/jpeg;base64,bad" },
    ])).toThrow("REVIEW_MEDIA_NOT_UPLOADED");
  });

  it("최대 5개를 강제하고 video poster도 영구 URL인지 검증한다", () => {
    expect(() => buildReviewMediaPayload(Array.from({ length: 6 }, (_, index) => ({
      kind: "image", src: `https://cdn.example/${index}.jpg`,
    })))).toThrow("REVIEW_MEDIA_LIMIT");
    expect(() => buildReviewMediaPayload([{
      kind: "video", src: "https://cdn.example/a.mp4", poster: "blob:https://cdn.example/poster",
    }])).toThrow("REVIEW_MEDIA_NOT_UPLOADED");
    expect(buildReviewMediaPayload([{
      kind: "video", src: "https://cdn.example/a.mp4", poster: "https://cdn.example/a.jpg",
    }])).toEqual([{
      kind: "video", src: "https://cdn.example/a.mp4", poster: "https://cdn.example/a.jpg",
    }]);
  });

  it("관리자만 기존 /assets 미디어를 보존할 수 있다", () => {
    expect(buildReviewMediaPayload(
      [{ kind: "image", src: "/assets/reviews/seed.jpg" }],
      { allowRootRelative: true },
    )).toEqual([{ kind: "image", src: "/assets/reviews/seed.jpg" }]);
  });
});
