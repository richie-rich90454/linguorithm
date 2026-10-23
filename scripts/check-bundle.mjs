import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const directory = "apps/web/dist/assets";
const entry = readdirSync(directory).filter((p) => /^index-.*\.js$/u.test(p));
if (!entry.length) throw new Error("Build the application before checking the bundle.");
const total = entry.reduce(
    (sum, name) => sum + gzipSync(readFileSync(`${directory}/${name}`)).length,
    0,
);
console.log(
    `Initial JavaScript: ${(total / 1024).toFixed(1)} KiB gzip; budget 250 KiB. Import parsers and analysis worker are separate.`,
);
if (total > 250 * 1024) process.exitCode = 1;
