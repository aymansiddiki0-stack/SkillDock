import { describe, expect, it } from "vitest";
import { normalizeDisplay, parseSkillList } from "../../src/normalization";

describe("parseSkillList", () => {
  it("splits lines, trims, and drops blanks", () => {
    expect(parseSkillList("  Python  \n\n  C++ \n\n")).toEqual(["Python", "C++"]);
  });

  it("removes duplicates and preserves first-occurrence order", () => {
    expect(parseSkillList("Python\nSQL\nPython\nC#\nSQL")).toEqual(["Python", "SQL", "C#"]);
  });

  it("collapses accidental repeated internal whitespace only", () => {
    expect(parseSkillList("Power   BI\nNode.js")).toEqual(["Power BI", "Node.js"]);
  });

  it("handles CRLF input", () => {
    expect(parseSkillList("Python\r\nSQL\r\n")).toEqual(["Python", "SQL"]);
  });
});

describe("normalizeDisplay", () => {
  it("replaces non-breaking spaces with regular spaces", () => {
    expect(normalizeDisplay("Power BI")).toBe("Power BI");
  });

  it("collapses whitespace introduced by nested HTML", () => {
    expect(normalizeDisplay("  Amazon 
  Web   Services ")).toBe("Amazon Web Services");
  });

  it("applies consistent Unicode normalization (NFC)", () => {
    const composed = "Résumé Writing"; // é as single code points
    const decomposed = "Résumé Writing"; // e + combining accent
    expect(normalizeDisplay(decomposed)).toBe(normalizeDisplay(composed));
  });
});
