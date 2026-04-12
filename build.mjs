import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [{ in: "src/popup/popup.ts", out: "popup" }],
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome110",
  logLevel: "info",
});

await cp("manifest.json", `${outdir}/manifest.json`);
await cp("src/popup/popup.html", `${outdir}/popup.html`);
await cp("src/popup/popup.css", `${outdir}/popup.css`);

console.log("Built extension into ./dist");
