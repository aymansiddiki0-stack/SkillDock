/**
 * Persistence: saved skills and the last run report, in chrome.storage.local
 * only (never the page's localStorage). Nothing leaves the browser.
 */

import type { RunReport } from "./types";

const SKILLS_KEY = "skills";
const LAST_REPORT_KEY = "lastReport";

export async function loadSkills(): Promise<string[]> {
  const data = await chrome.storage.local.get(SKILLS_KEY);
  const value = data[SKILLS_KEY];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function saveSkills(skills: string[]): Promise<void> {
  await chrome.storage.local.set({ [SKILLS_KEY]: skills });
}

export async function loadLastReport(): Promise<RunReport | null> {
  const data = await chrome.storage.local.get(LAST_REPORT_KEY);
  return (data[LAST_REPORT_KEY] as RunReport | undefined) ?? null;
}

export async function saveLastReport(report: RunReport): Promise<void> {
  await chrome.storage.local.set({ [LAST_REPORT_KEY]: report });
}
