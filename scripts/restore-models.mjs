import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
if (process.env.SYNTAX_MODEL_SOURCE === "candidate") {
    process.chdir(root);
    await import("./validate-models.mjs");
    console.log("Using explicitly selected, integrity-verified candidate models.");
    process.exit(0);
}
if (process.env.SYNTAX_MODEL_SOURCE && process.env.SYNTAX_MODEL_SOURCE !== "release")
    throw new Error("Unknown SYNTAX_MODEL_SOURCE; use release or candidate.");
const releases = resolve(root, "models/releases");
const manifest = JSON.parse(readFileSync(resolve(releases, "manifest.json"), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (base, path) => {
    const local = relative(base, path);
    return (
        !isAbsolute(local) &&
        local !== ".." &&
        !local.startsWith(".." + (process.platform === "win32" ? "\\" : "/"))
    );
};
if (
    manifest.schemaVersion !== 1 ||
    !/^[a-zA-Z0-9_-]+\.tar\.gz$/u.test(manifest.archive) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100
)
    throw new Error("Invalid model release manifest.");
const archive = readFileSync(resolve(releases, manifest.archive));
if (
    archive.length > 40_000_000 ||
    archive.length !== manifest.compressedBytes ||
    digest(archive) !== manifest.sha256
)
    throw new Error("Model release archive failed integrity verification.");
const tar = gunzipSync(archive, { maxOutputLength: 100_000_000 });
if (tar.length !== manifest.uncompressedBytes)
    throw new Error("Invalid model archive expansion size.");
const expected = new Map(manifest.files.map((record) => [record.path, record]));
if (expected.size !== manifest.files.length) throw new Error("Duplicate model release paths.");
const output = resolve(root, process.env.SYNTAX_MODEL_OUTPUT ?? "apps/web/public/models");
if (!inside(root, output)) throw new Error("Model destination escapes the project.");
const ensureDirectory = (directory) => {
    let existing = directory;
    while (!existsSync(existing)) existing = dirname(existing);
    if (!inside(root, realpathSync(existing)))
        throw new Error("Model destination follows a symlink outside the project.");
    mkdirSync(directory, { recursive: true });
};
ensureDirectory(output);
if (!inside(root, realpathSync(output))) throw new Error("Model destination escapes the project.");
const files = [];
for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) =>
        header
            .subarray(start, start + length)
            .toString("utf8")
            .split("\0", 1)[0];
    const name = text(0, 100),
        size = Number.parseInt(text(124, 12), 8);
    const record = expected.get(name),
        path = resolve(output, name);
    if (
        !record ||
        !inside(output, path) ||
        name.includes("\\") ||
        name.split("/").includes("..") ||
        header[156] !== 48 ||
        !Number.isSafeInteger(size) ||
        size !== record.bytes ||
        offset + 512 + size > tar.length
    )
        throw new Error("Invalid or unexpected model archive entry.");
    const storedChecksum = Number.parseInt(text(148, 8), 8);
    const actualChecksum = header.reduce(
        (sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte),
        0,
    );
    if (storedChecksum !== actualChecksum)
        throw new Error("Invalid model archive header checksum.");
    const bytes = tar.subarray(offset + 512, offset + 512 + size);
    if (digest(bytes) !== record.sha256) throw new Error(`Model file failed verification: ${name}`);
    files.push({ path, bytes });
    expected.delete(name);
    offset += 512 + Math.ceil(size / 512) * 512;
}
if (expected.size) throw new Error("Model archive is incomplete.");
let restored = 0;
for (const { path, bytes } of files) {
    ensureDirectory(dirname(path));
    if (
        !inside(output, realpathSync(dirname(path))) ||
        (existsSync(path) && !inside(output, realpathSync(path)))
    )
        throw new Error("Model output follows a symlink outside the asset directory.");
    if (!existsSync(path) || digest(readFileSync(path)) !== digest(bytes)) {
        writeFileSync(path, bytes);
        restored++;
    }
}
console.log(
    `Verified local ${manifest.version} release; restored ${restored} of ${files.length} files.`,
);
