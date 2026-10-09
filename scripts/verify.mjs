import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const html = await readFile(path.join(root, "index.html"), "utf8");
const failures = [];

for (const required of ["Java开发笔记", "粤ICP备2026012275号-1", "粤公网安备44030002010540号"]) {
  if (!html.includes(required)) failures.push(`missing required text: ${required}`);
}

for (const forbidden of [
  "PluginSearchWidget",
  "PluginCommentWidget",
  "/plugins/shiki/",
  "/plugins/editor-hyperlink-card/",
  "/halo-tracker.js",
]) {
  if (html.includes(forbidden)) failures.push(`backend resource still present: ${forbidden}`);
}

const resourcePattern = /(?:src|href|poster|data-src|data-lazy-src)\s*=\s*(['"])(\/[^'"?#]+)\1/gi;
const checked = new Set();
let match;
while ((match = resourcePattern.exec(html))) {
  const pathname = decodeURIComponent(match[2]);
  if (!/\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|map)$/i.test(pathname)) continue;
  if (checked.has(pathname)) continue;
  checked.add(pathname);
  try {
    await access(path.join(root, ...pathname.replace(/^\/+/, "").split("/")));
  } catch {
    failures.push(`missing local asset: ${pathname}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`verification passed: homepage and ${checked.size} directly referenced local assets`);
}
