import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = new URL(process.env.SNAPSHOT_URL || "https://www.hideshadow.com/");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "dist");
const tempDir = path.join(projectRoot, ".snapshot-tmp");

const backendPatterns = [
  /\/plugins\/PluginSearchWidget\//i,
  /\/plugins\/PluginCommentWidget\//i,
  /\/plugins\/shiki\//i,
  /\/plugins\/editor-hyperlink-card\//i,
  /\/halo-tracker\.js(?:\?|$)/i,
];

function assertInsideProject(target) {
  const relative = path.relative(projectRoot, path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside project: ${target}`);
  }
}

function isBackendResource(value) {
  return backendPatterns.some((pattern) => pattern.test(value));
}

function stripBackendTags(html) {
  return html
    .replace(/<script\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>[\s\S]*?<\/script\s*>/gi, (tag, _quote, src) =>
      isBackendResource(src) ? "" : tag,
    )
    .replace(/<link\b[^>]*\bhref=(['"])(.*?)\1[^>]*>/gi, (tag, _quote, href) =>
      isBackendResource(href) ? "" : tag,
    )
    .replace(/<!--[^>]*(?:PluginSearchWidget|plugin-comment-widget|plugin-shiki|plugin-editor-hyperlink-card)[^>]*-->/gi, "")
    .replace(
      /<noscript>\s*<link\s+rel=(['"])stylesheet\1\s+href=(['"])\/themes\/halo-theme-archer\/assets\/dist\/style\.css\2\s*\/?>\s*<\/noscript>/gi,
      '<noscript><link rel="stylesheet" href="/themes/halo-theme-archer/assets/dist/base.css"><link rel="stylesheet" href="/themes/halo-theme-archer/assets/dist/sidebar.css"></noscript>',
    );
}

function localUrl(value, base = SOURCE) {
  if (!value || /^(?:data:|blob:|mailto:|tel:|javascript:|#)/i.test(value)) return null;
  try {
    const url = new URL(value, base);
    return url.origin === SOURCE.origin ? url : null;
  } catch {
    return null;
  }
}

function publicPath(url) {
  const pathname = decodeURIComponent(url.pathname || "/");
  return pathname === "/" ? "/index.html" : pathname;
}

function diskPath(url, root = tempDir) {
  const relative = publicPath(url).replace(/^\/+/, "");
  const target = path.join(root, ...relative.split("/"));
  assertInsideProject(target);
  return target;
}

function rewriteSameOriginUrls(text, base = SOURCE) {
  return text.replace(/((?:src|href|poster|data-src|data-lazy-src)\s*=\s*['"])([^'"]+)(['"])/gi, (all, prefix, value, suffix) => {
    const url = localUrl(value, base);
    if (!url) return all;
    return `${prefix}${encodeURI(decodeURIComponent(url.pathname))}${suffix}`;
  });
}

function resourceCandidates(html, base = SOURCE) {
  const found = new Map();
  const attributes = /(?:src|href|poster|data-src|data-lazy-src)\s*=\s*(['"])(.*?)\1/gi;
  let match;
  while ((match = attributes.exec(html))) {
    const url = localUrl(match[2], base);
    if (!url || isBackendResource(url.href)) continue;
    const pathname = url.pathname.toLowerCase();
    const isAsset =
      pathname.startsWith("/themes/") ||
      pathname.startsWith("/upload/") ||
      pathname.startsWith("/assets/") ||
      pathname.startsWith("/plugins/") ||
      /\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|map)$/i.test(pathname);
    if (isAsset) found.set(url.href, url);
  }
  return [...found.values()];
}

function cssCandidates(css, base) {
  const found = new Map();
  const patterns = [/url\(\s*(['"]?)(.*?)\1\s*\)/gi, /@import\s+(?:url\()?\s*(['"])(.*?)\1\s*\)?/gi];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(css))) {
      const value = match[2];
      const url = localUrl(value, base);
      if (url && !isBackendResource(url.href)) found.set(url.href, url);
    }
  }
  return [...found.values()];
}

function rewriteCss(css, base) {
  const rewrite = (value) => {
    const url = localUrl(value, base);
    return url ? encodeURI(decodeURIComponent(url.pathname)) : value;
  };
  return css
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, quote, value) => `url(${quote}${rewrite(value)}${quote})`)
    .replace(/@import\s+(?:url\()?\s*(['"])(.*?)\1\s*\)?/gi, (_all, quote, value) => `@import ${quote}${rewrite(value)}${quote}`);
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "hideshadow-static-snapshot/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get("content-type") || "" };
}

async function saveAsset(url, queue, seen) {
  if (seen.has(url.href)) return;
  seen.add(url.href);

  const { bytes, type } = await fetchBytes(url);
  const target = diskPath(url);
  await mkdir(path.dirname(target), { recursive: true });

  const isCss = type.includes("text/css") || url.pathname.toLowerCase().endsWith(".css");
  if (isCss) {
    const css = new TextDecoder().decode(bytes);
    for (const candidate of cssCandidates(css, url)) queue.push(candidate);
    await writeFile(target, rewriteCss(css, url), "utf8");
  } else {
    await writeFile(target, bytes);
  }
  console.log(`saved ${url.pathname}`);
}

async function main() {
  assertInsideProject(outputDir);
  assertInsideProject(tempDir);
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  const response = await fetch(SOURCE, { headers: { "user-agent": "hideshadow-static-snapshot/1.0" } });
  if (!response.ok) throw new Error(`Homepage request failed: ${response.status} ${response.statusText}`);

  let html = await response.text();
  html = stripBackendTags(html);
  html = rewriteSameOriginUrls(html, SOURCE);
  html = html.replace(/<meta\s+name=(['"])generator\1[^>]*>\s*/i, "");
  html = html.replace(/<\/body>/i, "<!-- Static homepage snapshot; backend features intentionally removed. -->\n</body>");

  const queue = resourceCandidates(html, SOURCE);
  const seen = new Set();
  while (queue.length) {
    const url = queue.shift();
    try {
      await saveAsset(url, queue, seen);
    } catch (error) {
      console.warn(`warning: ${error.message}`);
    }
  }

  await writeFile(path.join(tempDir, "index.html"), html, "utf8");
  await rm(outputDir, { recursive: true, force: true });
  await rename(tempDir, outputDir);

  const finalHtml = await readFile(path.join(outputDir, "index.html"), "utf8");
  console.log(`snapshot complete: ${finalHtml.length} bytes of HTML, ${seen.size} asset requests`);
}

main().catch(async (error) => {
  await rm(tempDir, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
