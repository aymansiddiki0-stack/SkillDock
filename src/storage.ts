/**
 * Persistence: saved skills in chrome.storage.local only (never the page's
 * localStorage). Nothing leaves the browser.
 */

const SKILLS_KEY = "skills";

export async function loadSkills(): Promise<string[]> {
  const data = await chrome.storage.local.get(SKILLS_KEY);
  const value = data[SKILLS_KEY];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function saveSkills(skills: string[]): Promise<void> {
  await chrome.storage.local.set({ [SKILLS_KEY]: skills });
}
