import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Load a fixture file's markup into the current jsdom document body. */
export function loadFixture(name: string): void {
  document.body.innerHTML = readFileSync(join(here, name), "utf8");
}

export function resetDom(): void {
  document.body.innerHTML = "";
}
