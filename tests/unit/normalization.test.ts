import { describe, expect, it } from "vitest";
import { isExactMatch, normalizeDisplay, parseSkillList } from "../../src/normalization";

describe("parseSkillList", () => {
  it("splits lines, trims, and drops blanks", () => {
    expect(parseSkillList("  Python  \n\n  C++ \n\n")).toEqual(["Python", "C++"]);
  });

  it("removes exact duplicates and preserves first-occurrence order", () => {
    expect(parseSkillList("Python\nSQL\nPython\nC#\nSQL")).toEqual(["Python", "SQL", "C#"]);
  });

  it("preserves capitalization and punctuation exactly", () => {
    const skills = [
      "C++",
      "C#",
      ".NET",
      "Node.js",
      "Power BI",
      "Amazon Web Services (AWS)",
      "Microsoft SQL Server",
      "Apache Kafka",
    ];
    expect(parseSkillList(skills.join("\n"))).toEqual(skills);
  });

  it("does not merge different casings or spellings", () => {
    expect(parseSkillList("python\nPython\nPYTHON")).toEqual(["python", "Python", "PYTHON"]);
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
    expect(normalizeDisplay("Power\u00A0BI")).toBe("Power BI");
  });

  it("collapses whitespace introduced by nested HTML", () => {
    expect(normalizeDisplay("  Amazon \n  Web   Services ")).toBe("Amazon Web Services");
  });

  it("applies consistent Unicode normalization (NFC)", () => {
    const composed = "R\u00E9sum\u00E9 Writing"; // e-acute as single code points
    const decomposed = "Re\u0301sume\u0301 Writing"; // e + combining accent
    expect(normalizeDisplay(decomposed)).toBe(normalizeDisplay(composed));
  });
});

describe("isExactMatch — the anti-fuzzy guarantee", () => {
  it("matches identical display text", () => {
    expect(isExactMatch("Python", "Python")).toBe(true);
    expect(isExactMatch("Power BI", "Power\u00A0BI")).toBe(true);
    expect(isExactMatch("C++", " C++ ")).toBe(true);
  });

  it.each([
    ["Python", "Python Programming"],
    ["SQL", "Microsoft SQL Server"],
    ["C", "C++"],
    ["C", "C#"],
    ["AWS", "Amazon Web Services"],
    ["PowerBI", "Power BI"],
    ["Node", "Node.js"],
    ["Java", "JavaScript"],
    ["java", "Java"],
    ["python", "Python"],
    [".NET", "NET"],
    ["React", "React.js"],
    ["Go", "Google Go"],
  ])("never matches %s against %s", (a, b) => {
    expect(isExactMatch(a, b)).toBe(false);
    expect(isExactMatch(b, a)).toBe(false);
  });

  it("is sensitive to word order, hyphens, periods, plus and number signs, versions", () => {
    expect(isExactMatch("Machine Learning", "Learning Machine")).toBe(false);
    expect(isExactMatch("E-commerce", "Ecommerce")).toBe(false);
    expect(isExactMatch("Vue.js", "Vuejs")).toBe(false);
    expect(isExactMatch("Python 3", "Python 2")).toBe(false);
    expect(isExactMatch("C++", "C+")).toBe(false);
    expect(isExactMatch("C#", "C")).toBe(false);
  });
});
