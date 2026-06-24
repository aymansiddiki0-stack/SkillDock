import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [
    { in: "src/content.ts", out: "content" },
    { in: "src/popup/popup-entry.ts", out: "popup" },
  ],
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome110",
  sourcemap: false,
  minify: false,
  logLevel: "info",
});

await cp("manifest.json", `${outdir}/manifest.json`);
await cp("src/popup/popup.html", `${outdir}/popup.html`);
await cp("src/popup/popup.css", `${outdir}/popup.css`);
await cp("icons", `${outdir}/icons`, { recursive: true });

console.log("Built extension into ./dist — load it via chrome://extensions → Load unpacked.");
