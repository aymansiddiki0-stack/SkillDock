import { beforeEach, describe, expect, it } from "vitest";
import { loadFixture, resetDom } from "../fixtures/load";
import { locateSkillsField } from "../../src/workday/locate-skills-field";

beforeEach(resetDom);

describe("locateSkillsField", () => {
  it("finds a standard labeled Workday-style Skills combobox", () => {
    loadFixture("standard-labeled.html");
    expect(locateSkillsField()?.id).toBe("skills-input");
  });

  it("finds an ARIA-only Skills combobox with no automation ids", () => {
    loadFixture("aria-combobox.html");
    const field = locateSkillsField();
    expect(field?.getAttribute("aria-labelledby")).toBe("skills-heading");
  });

  it("picks the enabled, visible Skills field among many comboboxes", () => {
    loadFixture("multiple-comboboxes.html");
    expect(locateSkillsField()?.id).toBe("real-skills");
  });
});
