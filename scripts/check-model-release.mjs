import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const clone = mkdtempSync(resolve(root, ".cache/model-release-check-"));
const manifest = JSON.parse(readFileSync(resolve(root, "models/releases/manifest.json"), "utf8"));
for (const name of [
    "scripts/restore-models.mjs",
    "models/releases/manifest.json",
    `models/releases/${manifest.archive}`,
]) {
    mkdirSync(dirname(resolve(clone, name)), { recursive: true });
    copyFileSync(resolve(root, name), resolve(clone, name));
}
const run = () =>
    spawnSync(process.execPath, [resolve(clone, "scripts/restore-models.mjs")], {
        cwd: clone,
        encoding: "utf8",
        env: { ...process.env, SYNTAX_MODEL_SOURCE: "release" },
        shell: false,
    });
const assertSuccess = () => {
    const result = run();
    if (result.status !== 0)
        throw new Error(
            result.stderr || result.stdout || "Model restoration did not exit successfully.",
        );
};
assertSuccess();
for (const file of manifest.files) {
    const bytes = readFileSync(resolve(clone, "apps/web/public/models", file.path));
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error(`Fresh restore differs: ${file.path}`);
}
writeFileSync(resolve(clone, "apps/web/public/models/lexicon.json"), "{}");
assertSuccess();
const archivePath = resolve(clone, "models/releases", manifest.archive);
const corrupted = readFileSync(archivePath);
corrupted[20] ^= 1;
writeFileSync(archivePath, corrupted);
const rejected = run();
if (rejected.status === 0 || !rejected.stderr.includes("integrity verification"))
    throw new Error("A corrupt release archive was not rejected.");
const report = {
    files: manifest.files.length,
    freshRestore: true,
    corruptedAssetRepaired: true,
    corruptedArchiveRejected: true,
    location: relative(root, clone).replaceAll("\\", "/"),
    version: manifest.version,
};
mkdirSync(resolve(root, "reports"), { recursive: true });
writeFileSync(
    resolve(root, "reports/model-release-check.json"),
    JSON.stringify(report, null, 4) + "\n",
);
console.log(
    `Model release check passed: ${manifest.files.length} fresh files, damaged asset repaired, corrupt archive rejected.`,
);
