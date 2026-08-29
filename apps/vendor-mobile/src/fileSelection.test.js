import { describe, expect, it } from "vitest";
import { mergeSelectedFiles } from "./fileSelection.js";

const file = (name, size, lastModified = 1) => ({ name, size, type: "image/jpeg", lastModified });

describe("mergeSelectedFiles", () => {
  it("keeps files selected across multiple picker sessions", () => {
    expect(mergeSelectedFiles([file("front.jpg", 10)], [file("side.jpg", 12)]).map((item) => item.name))
      .toEqual(["front.jpg", "side.jpg"]);
  });

  it("does not add the exact same file twice", () => {
    const front = file("front.jpg", 10);
    expect(mergeSelectedFiles([front], [front])).toEqual([front]);
  });
});
