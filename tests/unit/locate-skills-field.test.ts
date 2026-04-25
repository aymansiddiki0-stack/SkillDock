import { beforeEach, describe, expect, it } from "vitest";
import { loadFixture, resetDom } from "../fixtures/load";
import { locateSkillsField } from "../../src/workday/locate-skills-field";

beforeEach(resetDom);

describe("locateSkillsField", () => {
  it("finds a standard labeled Workday-style Skills combobox", () => {
    loadFixture("standard-labeled.html");
    const result = locateSkillsField();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.field.id).toBe("skills-input");
    }
  });

  it("finds an ARIA-only Skills combobox with no automation ids", () => {
    loadFixture("aria-combobox.html");
    const result = locateSkillsField();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.field.getAttribute("aria-labelledby")).toBe("skills-heading");
    }
  });

  it("picks the enabled, visible Skills field among many comboboxes", () => {
    loadFixture("multiple-comboboxes.html");
    const result = locateSkillsField();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.field.id).toBe("real-skills");
    }
  });

  it("refuses to guess between two equally plausible Skills fields", () => {
    loadFixture("ambiguous.html");
    const result = locateSkillsField();
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });
});
