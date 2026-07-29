import { describe, expect, it } from "vitest";
import { styleSeedData } from "../styleSeedData.js";

const productSignature = (src) => {
  const decoded = decodeURIComponent(String(src || ""));
  // 셀프호스팅 파일명은 제품 코드로 시작한다: /assets/designs/<CODE>-....jpg
  const productMatch = decoded.match(/\/assets\/designs\/([A-Za-z0-9]+)[-.]/);
  const code = productMatch?.[1] || "";
  const numericGroups = [...code.matchAll(/\d{3,}/g)].map((match) => match[0]);
  return numericGroups.sort((a, b) => b.length - a.length)[0] || code;
};

// v17 카탈로그 (scripts/import_style_csvs.py 생성). 스크립트 재실행 시 이 맵도 함께 갱신.
const expectedProductTitles = {
  "RING-001": "Classic Four-Prong Three Stone",
  "RING-002": "Classic Six-Prong Solitaire",
  "RING-003": "Classic Four-Prong Side Stone",
  "RING-004": "Classic Four-Prong Solitaire",
  "RING-005": "Four-Prong Cathedral Solitaire",
  "RING-006": "Six-Prong Cathedral Solitaire",
  "RING-007": "Four-Prong Basket Solitaire",
  "RING-008": "Four-Prong Hidden Halo Solitaire",
  "RING-009": "Six-Prong Hidden Halo Solitaire",
  "RING-010": "Four-Prong Half-Eternity Pavé Solitaire",
  "RING-011": "Half-Eternity Pavé Halo",
  "RING-012": "Four-Prong Half-Eternity Pavé Three Stone",
  "RING-013": "Six-Prong Half-Eternity Pavé Solitaire",
  "RING-014": "Four-Prong Full-Eternity Pavé Solitaire",
  "RING-015": "Three-Quarter Eternity Pavé Halo",
  "RING-016": "Four-Prong Three-Quarter Eternity Pavé Solitaire",
  "RING-017": "Three-Quarter Eternity Pavé Hidden Halo",
  "RING-018": "Four-Prong Knife Edge Solitaire",
  "RING-019": "Four-Prong Knife Edge Pavé Three Stone",
  "RING-020": "Six-Prong Knife Edge Solitaire",
  "RING-021": "Four-Prong Knife Edge Pavé Solitaire",
  "RING-022": "French Pavé Eternity Band",
  "RING-023": "Low Dome Basket Eternity Band",
  "RING-024": "Pavé Band",
  "RING-025": "Channel Set Band",
  "RING-026": "Classic Four-Prong Hidden Halo Three Stone",
  "EARR-001": "Round Diamond Stud Earrings",
  "EARR-002": "Inside-Out Hoop Earrings",
  "EARR-003": "Princess Halo Stud Earrings",
  "EARR-004": "Cushion Huggie Hoop Earrings",
  "EARR-005": "Emerald Halo Drop Earrings",
  "EARR-006": "Round and Pear Drop Earrings",
  "EARR-007": "Marquise Flower Stud Earrings",
  "BRAC-001": "Four-Prong Tennis Bracelet",
  "BRAC-002": "Boundless Eternity Bracelet",
  "BRAC-003": "Emerald Tennis Bracelet",
  "BRAC-004": "Shared-Prong Bangle Bracelet",
  "BRAC-005": "Boundless Station Bracelet",
  "NECK-001": "Round Solitaire Pendant",
  "NECK-002": "Round Halo Pendant",
  "NECK-003": "Cluster Flower Pendant",
  "NECK-004": "Thirteen-Stone Demi Eternity Necklace",
  "NECK-005": "Round and Pear Diamond Drop Necklace",
  "NECK-006": "Marquise Pear Flower Pendant",
  "NECK-007": "Four-Prong Tennis Necklace",
  "NECK-008": "Station Necklace",
  "NECK-009": "Diamond Cross Pendant",
  "NECK-010": "Shield Diamond Cross Statement Pendant",
};

const normalizeStyleKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const duplicateGroups = (keyForStyle) => {
  const groups = new Map();
  styleSeedData.forEach((style) => {
    const key = keyForStyle(style);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(style.id);
  });
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
};

describe("style seed media", () => {
  it("only publishes styles with original product media", () => {
    expect(styleSeedData.length).toBeGreaterThan(0);

    const invalid = styleSeedData.filter((style) => {
      const media = Array.isArray(style.media) ? style.media : [];
      return media.length === 0
        || style.mediaComplete !== true
        || media.some((item) => !String(item.src || "").startsWith("/assets/designs/"));
    });

    expect(invalid).toEqual([]);
  });

  it("keeps each style carousel scoped to one product family", () => {
    const mismatched = styleSeedData.flatMap((style) => {
      const media = Array.isArray(style.media) ? style.media : [];
      const expected = productSignature(media[0]?.src);
      return media
        .filter((item) => productSignature(item.src) !== expected)
        .map((item) => ({
          styleId: style.id,
          expected,
          actual: productSignature(item.src),
        }));
    });

    expect(mismatched).toEqual([]);
  });

  it("limits every style carousel to five assets", () => {
    const overLimit = styleSeedData
      .filter((style) => (style.media || []).length > 5)
      .map((style) => ({ styleId: style.id, count: style.media.length }));

    expect(overLimit).toEqual([]);
  });

  it("uses product-matched titles for every seeded style", () => {
    const actualTitles = Object.fromEntries(styleSeedData.map((style) => [style.id, style.name.en]));

    expect(actualTitles).toEqual(expectedProductTitles);
  });

  it("does not publish duplicate style identities", () => {
    expect(duplicateGroups((style) => [
      style.category,
      style.subcategory,
      normalizeStyleKey(style.name?.en),
    ].join("|"))).toEqual([]);
  });

  it("does not publish the same supplier product twice", () => {
    expect(duplicateGroups((style) => normalizeStyleKey(style.supplierEvidence))).toEqual([]);
  });

  it("does not publish the same category product image twice", () => {
    expect(duplicateGroups((style) => {
      const signature = productSignature(style.coverImage || style.media?.[0]?.src);
      return signature ? [style.category, style.subcategory, signature].join("|") : "";
    })).toEqual([]);
  });

  it("maps the classic six-prong solitaire grid style to its own product media", () => {
    const style = styleSeedData.find((item) => item.id === "RING-002");

    expect(style?.name.en).toBe("Classic Six-Prong Solitaire");
    expect(style?.name.ko).toBe("클래식 6프롱 솔리테어");
    expect(style?.supplierEvidence).toContain("Classic-Six-Prong-Solitaire");
    expect(style?.coverImage).toContain("BE121H6");
  });
});
