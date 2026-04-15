export function normalizeDisplay(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
