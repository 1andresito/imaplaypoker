// Regenerates the favicon and the app-icon source from src/ui/logo.ts.
// Usage: node --experimental-transform-types scripts/make-icons.mjs && npx tauri icon app-icon.svg
import { writeFileSync } from "node:fs";
import { chipStackSvg } from "../src/ui/logo.ts";

writeFileSync("app-icon.svg", chipStackSvg({ background: true }));
writeFileSync("public/favicon.svg", chipStackSvg({ simple: true }));
console.log("Wrote app-icon.svg and public/favicon.svg");
