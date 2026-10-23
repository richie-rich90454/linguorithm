import { readFileSync, existsSync, writeFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
const root = realpathSync(resolve("apps/web/public/models"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const registry = read(resolve(root, "registry.json"));
if (registry.schemaVersion !== 2) throw new Error("Unsupported production registry");
const files = [];
const verify = (record, directory = root) => {
    if (!record || typeof record.path !== "string" || !record.path)
        throw new Error("Invalid resource record");
    const target = realpathSync(resolve(directory, record.path)),
        local = relative(realpathSync(directory), target);
    if (
        local === ".." ||
        local.startsWith("../") ||
        local.startsWith("..\\") ||
        isAbsolute(local) ||
        !/^[a-f0-9]{64}$/u.test(record.sha256)
    )
        throw new Error("Invalid resource path/hash");
    const bytes = readFileSync(target);
    if (hash(bytes) !== record.sha256) throw new Error(`Integrity mismatch: ${record.path}`);
    files.push({
        path: relative(root, target).replaceAll("\\", "/"),
        sha256: record.sha256,
        bytes: bytes.length,
    });
    return bytes;
};
for (const name of ["tagger", "parser", "classifier", "lexicon", "dictionary", "contextual"]) {
    const resource = registry[name];
    if (!resource) throw new Error(`Missing ${name}`);
    const data = JSON.parse(verify(resource).toString("utf8"));
    if (["tagger", "parser", "classifier"].includes(name)) {
        for (const key of [
            "version",
            "task",
            "artifact",
            "language",
            "sha256",
            "provenance",
            "inputSchema",
            "outputSchema",
            "training",
            "evaluation",
            "calibration",
            "limitations",
        ])
            if (data[key] === undefined) throw new Error(`${name}: missing ${key}`);
        for (const key of ["seed", "dependencies", "configuration", "splitPolicy", "quantization"])
            if (data.training[key] === undefined)
                throw new Error(`${name}: missing training.${key}`);
        if (
            data.language !== "en-US" ||
            !data.provenance.length ||
            data.provenance.some((p) => !p.source || !p.license || !p.permittedUse || !p.sha256)
        )
            throw new Error(`${name}: incomplete provenance`);
        verify({ path: data.artifact, sha256: data.sha256 }, resolve(root, "weights"));
    }
}
for (const name of ["ewt-CC-BY-SA-4.0.txt", "ewt-attribution.md", "dictionary-notices.txt"])
    if (!existsSync(resolve(root, "licenses", name))) throw new Error(`Missing notice ${name}`);
const report = { version: registry.version, verified: true, files, policy: registry.policy };
writeFileSync("reports/model-integrity.json", JSON.stringify(report, null, 4) + "\n");
console.log(`Verified ${files.length} model resources, metadata, hashes, and notices.`);
