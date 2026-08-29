import { describe, it, expect } from "vitest";
import { matchFaq, faqChips, FAQ } from "../chatFaq.js";

describe("chatFaq 지식베이스", () => {
  it("기본 질문을 올바른 토픽으로 매칭한다", () => {
    expect(matchFaq("how much does it cost?", "en").id).toBe("pricing");
    expect(matchFaq("이거 가격 얼마예요?", "ko").id).toBe("pricing");
    expect(matchFaq("무료 배송 되나요?", "ko").id).toBe("shipping");
    expect(matchFaq("제작 기간이 얼마나 걸려요?", "ko").id).toBe("lead_time");
    expect(matchFaq("¿cuánto tarda el pedido?", "es").id).toBe("lead_time");
    expect(matchFaq("do you have oval or emerald cut?", "en").id).toBe("shapes");
    expect(matchFaq("培育钻石是真的吗", "zh").id).toBe("lab");
    expect(matchFaq("what is my ring size", "en").id).toBe("ring_size");
    expect(matchFaq("¿tienen garantía?", "es").id).toBe("warranty");
    expect(matchFaq("can I add an engraving?", "en").id).toBe("engraving");
  });

  it("요청 로케일로 답변을 반환한다", () => {
    expect(matchFaq("price", "ko").answer).toMatch(/[가-힣]/);
    expect(matchFaq("price", "es").answer.length).toBeGreaterThan(20);
    // 없는 로케일은 영어로 폴백
    expect(matchFaq("price", "fr").answer).toBe(matchFaq("price", "en").answer);
  });

  it("매칭 안 되면 null(→ 사람이 응대)", () => {
    expect(matchFaq("xyzzy total nonsense qwerty", "en")).toBeNull();
    expect(matchFaq("", "en")).toBeNull();
    expect(matchFaq(null, "en")).toBeNull();
  });

  it("상담원 연결 off면 이메일·Instagram 직접 연락처를 반환한다", () => {
    const result = matchFaq("Can I talk to a person?", "en", { humanHandoffEnabled: false });
    expect(result.id).toBe("consultation");
    expect(result.answer).toContain("support@belovediamond.com");
    expect(result.answer).toContain("@belovediamondjewelry");
    expect(result.answer).toContain("instagram.com/belovediamondjewelry");
  });

  it("모든 엔트리는 4개 언어 질문·답변을 갖춘다", () => {
    for (const e of FAQ) {
      for (const loc of ["en", "ko", "zh", "es"]) {
        expect(typeof e.a[loc]).toBe("string");
        expect(e.a[loc].length).toBeGreaterThan(15);
        expect(typeof e.q[loc]).toBe("string");
      }
    }
  });

  it("위젯 칩은 로케일 라벨로 6개를 준다", () => {
    expect(faqChips("en")).toHaveLength(6);
    expect(faqChips("ko")[0].label).toMatch(/[가-힣]/);
    expect(faqChips("zh").every((c) => c.id && c.label)).toBe(true);
  });
});
