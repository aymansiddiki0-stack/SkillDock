/**
 * Persistence: saved skills and the last run report, in chrome.storage.local
 * only (never the page's localStorage). Nothing leaves the browser.
 */

import type { Portfolio, PortfolioStore, RunReport } from "./types";

const SKILLS_KEY = "skills";
const LAST_REPORT_KEY = "lastReport";
const PORTFOLIOS_KEY = "portfolios";

function newPortfolioId(): string {
  return `p_${crypto.randomUUID()}`;
}

function isPortfolio(v: unknown): v is Portfolio {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Portfolio).id === "string" &&
    typeof (v as Portfolio).name === "string" &&
    Array.isArray((v as Portfolio).skills) &&
    (v as Portfolio).skills.every((s) => typeof s === "string")
  );
}

function isValidStore(v: unknown): v is PortfolioStore {
  if (typeof v !== "object" || v === null) return false;
  const store = v as PortfolioStore;
  return (
    store.schemaVersion === 1 &&
    Array.isArray(store.portfolios) &&
    store.portfolios.length > 0 &&
    store.portfolios.every(isPortfolio) &&
    typeof store.activePortfolioId === "string"
  );
}

/**
 * Loads the portfolio store, migrating the legacy single skill list on first
 * read. Migration is idempotent: once `portfolios` exists, this never
 * touches the legacy `skills` key again (it is left in place, just inert).
 */
export async function loadPortfolioStore(): Promise<PortfolioStore> {
  const data = await chrome.storage.local.get([PORTFOLIOS_KEY, SKILLS_KEY]);
  const existing = data[PORTFOLIOS_KEY];
  if (isValidStore(existing)) {
    if (existing.portfolios.some((p) => p.id === existing.activePortfolioId)) return existing;
    // Corrupted active id — self-heal instead of treating the whole store as invalid.
    const healed: PortfolioStore = { ...existing, activePortfolioId: existing.portfolios[0]!.id };
    await savePortfolioStore(healed);
    return healed;
  }

  const legacySkills = data[SKILLS_KEY];
  const skills = Array.isArray(legacySkills)
    ? legacySkills.filter((v): v is string => typeof v === "string")
    : [];
  const portfolio: Portfolio = { id: newPortfolioId(), name: "My Skills", skills };
  const migrated: PortfolioStore = { schemaVersion: 1, portfolios: [portfolio], activePortfolioId: portfolio.id };
  await savePortfolioStore(migrated);
  return migrated;
}

export async function savePortfolioStore(store: PortfolioStore): Promise<void> {
  await chrome.storage.local.set({ [PORTFOLIOS_KEY]: store });
}

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
