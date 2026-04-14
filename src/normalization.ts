export function normalizeDisplay(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseSkillList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const skill = normalizeDisplay(rawLine);
    if (skill.length === 0) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}
