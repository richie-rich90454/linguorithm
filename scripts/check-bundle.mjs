import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const dist = "apps/web/dist";
const manifestPath = `${dist}/.vite/manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const htmlEntry = manifest["index.html"];
if (!htmlEntry?.isEntry) throw new Error("Build manifest has no index.html entry.");

const initialScripts = new Set();
const visited = new Set();
function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Build manifest references missing static chunk: ${key}`);
    if (/\.m?js$/u.test(chunk.file)) initialScripts.add(chunk.file);
    for (const imported of chunk.imports ?? []) visit(imported);
}

visit("index.html");
const names = [...initialScripts].sort();
const bytes = names.reduce(
    (sum, name) => sum + gzipSync(readFileSync(`${dist}/${name}`)).length,
    0,
);
const budget = 104.7 * 1024;
console.log(
    `Initial JavaScript: ${(bytes / 1024).toFixed(1)} KiB gzip across ${names.length} statically imported chunks; budget 104.7 KiB. Dynamic views and the analysis worker are excluded.`,
);
if (bytes > budget) process.exitCode = 1;
