import { describe, expect, it } from "vitest";
import { parseSkillList } from "../../src/normalization";

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
});
