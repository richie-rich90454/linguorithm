import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { gzipSync } from "node:zlib";
import "./validate-models.mjs";

const source = resolve("apps/web/public/models");
const destination = resolve("models/releases");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const paths = [];
function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Model release inputs cannot be symlinks.");
        if (entry.isDirectory()) walk(path);
        else if (!entry.name.includes(".int8.")) paths.push(path);
    }
}
walk(source);
const chunks = [],
    files = [];
for (const path of paths.sort()) {
    const name = relative(source, path).replaceAll("\\", "/");
    if (Buffer.byteLength(name) > 100) throw new Error("Model archive path is too long.");
    const bytes = readFileSync(path),
        header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    const octal = (value, start, length) =>
        header.write(value.toString(8).padStart(length - 1, "0") + "\0", start, length, "ascii");
    octal(0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(bytes.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
    files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
}
chunks.push(Buffer.alloc(1024));
const tar = Buffer.concat(chunks),
    archive = gzipSync(tar, { level: 9 });
const version = JSON.parse(readFileSync(resolve(source, "registry.json"), "utf8")).version;
mkdirSync(destination, { recursive: true });
const name = `${version}.tar.gz`;
writeFileSync(resolve(destination, name), archive);
writeFileSync(
    resolve(destination, "manifest.json"),
    JSON.stringify(
        {
            schemaVersion: 1,
            version,
            archive: name,
            sha256: digest(archive),
            compressedBytes: archive.length,
            uncompressedBytes: tar.length,
            files,
            licenseNotices:
                "licenses/ inside the archive; preserve all corpus, dictionary, and runtime notices",
        },
        null,
        4,
    ) + "\n",
);
console.log(
    `Packaged ${files.length} model files into ${name} (${(archive.length / 1048576).toFixed(1)} MiB).`,
);
