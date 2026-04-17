/** Characters that render as a plain space but are distinct code points. */
const SPACE_LIKE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Normalize a string for display comparison only.
 * - Unicode NFC (é as one code point vs e + combining accent)
 * - space-like characters → regular space
 * - runs of whitespace (including newlines from nested HTML) → single space
 * - trim
 *
 * This never changes which visible characters are present. "C++" stays "C++",
 * "Power BI" stays different from "PowerBI".
 */
export function normalizeDisplay(text: string): string {
  return text
    .normalize("NFC")
    .replace(SPACE_LIKE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The one and only equality rule for skills.
 * No fuzzy, substring, prefix, case-insensitive, or synonym matching:
 * lowercasing here would happily turn "java" into "Java" and "c" into "C"
 * on a real job application.
 */
export function isExactMatch(a: string, b: string): boolean {
  return normalizeDisplay(a) === normalizeDisplay(b);
}

export function parseSkillList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const skill = normalizeDisplay(rawLine);
    if (skill.length === 0) continue;
    if (seen.has(skill)) continue;
    seen.add(skill);
    out.push(skill);
  }
  return out;
}
