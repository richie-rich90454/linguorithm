import { expect, test, type Page } from "@playwright/test";
import { waitForAnalysis } from "./helpers";
import { readFile } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";
import type { Backup } from "../../packages/engine/src/domain";

// These tests exercise import and database boundaries without a service-worker cache.
test.use({ serviceWorkers: "block" });

async function exportBackup(page: Page): Promise<Backup> {
    await page.getByRole("button", { name: "Your progress" }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const path = await (await downloading).path();
    return JSON.parse(await readFile(path!, "utf8")) as Backup;
}

function dishonestCompressedDocx(): Buffer {
    const expanded = Buffer.alloc(30_000_001, 0x41);
    const compressed = deflateRawSync(expanded, { level: 9 });
    const checksum = crc32(expanded);
    const name = Buffer.from("word/document.xml");
    const reportedSize = 64;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(reportedSize, 22);
    local.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(reportedSize, 24);
    directory.writeUInt16LE(name.length, 28);
    const directoryOffset = local.length + name.length + compressed.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(directory.length + name.length, 12);
    end.writeUInt32LE(directoryOffset, 16);
    const archive = Buffer.concat([local, name, compressed, directory, name, end]);
    expect(expanded.length).toBeGreaterThan(30_000_000);
    expect(archive.length).toBeLessThan(100_000);
    expect(archive.readUInt32LE(directoryOffset + 24)).toBe(reportedSize);
    return archive;
}

test("upgrades a real v1 database with chronological repeat numbers and intact learner data", async ({
    page,
}) => {
    const at = "2026-10-20T00:00:00.000Z";
    const seed = {
        documents: [
            {
                id: "legacy-document",
                title: "Legacy Unicode essay",
                revisions: [
                    { text: "Café 😀 — Students are ready.", reason: "Original", at },
                    {
                        text: "Café 😀 — Students are careful.",
                        reason: "Edited essay",
                        at: "2026-10-21T00:00:00.000Z",
                    },
                ],
                cursor: 0,
                updatedAt: "2026-10-21T00:00:00.000Z",
            },
        ],
        skills: [
            {
                skill: "agreement",
                mastery: 0.63,
                attempts: 3,
                correct: 1,
                due: "2026-10-23T00:00:00.000Z",
                interval: 2,
                lastExercise: "agreement-1",
            },
        ],
        // Insertion order and primary-key order both differ from response chronology.
        attempts: [
            {
                id: "a-third",
                exerciseId: "agreement-1",
                skill: "agreement",
                answer: 1,
                correct: true,
                hints: 0,
                at: "2026-10-20T00:03:00.000Z",
            },
            {
                id: "m-other",
                exerciseId: "verbs-1",
                skill: "verb-forms",
                answer: 0,
                correct: false,
                hints: 0,
                at: "2026-10-20T00:01:00.000Z",
            },
            {
                id: "z-first",
                exerciseId: "agreement-1",
                skill: "agreement",
                answer: 0,
                correct: false,
                hints: 1,
                at,
            },
            {
                id: "b-second",
                exerciseId: "agreement-1",
                skill: "agreement",
                answer: 1,
                correct: true,
                hints: 0,
                at: "2026-10-20T00:02:00.000Z",
            },
        ],
        materials: [
            {
                id: "legacy-material",
                name: "Retained notes.md",
                text: "# Café notes\nA noun is a word that names a person, place, thing, or idea.",
                importedAt: at,
                format: "md",
            },
        ],
    } satisfies Pick<Backup, "documents" | "skills" | "attempts" | "materials">;
    await page.route("**/__legacy-seed", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><title>Legacy database seed</title>",
        }),
    );
    await page.goto("/__legacy-seed");
    const legacyVersion = await page.evaluate(async (records) => {
        // Dexie stores its schema version 1 as native IndexedDB version 10.
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const opening = indexedDB.open("syntax-local", 10);
            opening.onupgradeneeded = () => {
                const schemas = [
                    ["documents", "id", ["updatedAt"]],
                    ["skills", "skill", ["due"]],
                    ["attempts", "id", ["exerciseId", "at"]],
                    ["materials", "id", ["importedAt"]],
                ] as const;
                for (const [name, keyPath, indexes] of schemas) {
                    const store = opening.result.createObjectStore(name, { keyPath });
                    for (const index of indexes) store.createIndex(index, index);
                }
            };
            opening.onsuccess = () => resolve(opening.result);
            opening.onerror = () => reject(opening.error);
            opening.onblocked = () => reject(new Error("Legacy database creation was blocked."));
        });
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(Object.keys(records), "readwrite");
            for (const [store, values] of Object.entries(records))
                for (const value of values) transaction.objectStore(store).add(value);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
        const version = db.version;
        db.close();
        return version;
    }, seed);
    expect(legacyVersion).toBe(10);
    await page.goto("/");
    await expect(page.getByLabel("Essay title")).toHaveValue("Legacy Unicode essay");
    await expect(page.getByLabel("Annotated essay")).toHaveText(
        seed.documents[0]!.revisions[0]!.text,
    );
    const backup = await exportBackup(page);
    expect(backup.version).toBe(2);
    expect(backup.documents).toEqual(seed.documents);
    expect(backup.skills).toEqual(seed.skills);
    expect(backup.materials).toEqual(seed.materials);
    expect(backup.attempts).toHaveLength(seed.attempts.length);
    const counts: Record<string, number> = {
        "z-first": 1,
        "b-second": 2,
        "a-third": 3,
        "m-other": 1,
    };
    for (const original of seed.attempts)
        expect(backup.attempts.find((attempt) => attempt.id === original.id)).toEqual({
            ...original,
            phase: "practice",
            attemptNumber: counts[original.id],
        });
    await page.reload();
    await expect(page.getByLabel("Essay title")).toHaveValue("Legacy Unicode essay");
    const again = await exportBackup(page);
    expect(again.attempts).toEqual(backup.attempts);
    expect(again.documents).toEqual(backup.documents);
});

test("rejects actual DOCX expansion above 30 MB despite a small claimed size before the parser runs", async ({
    page,
}) => {
    await page.route(/\/assets\/mammoth\.browser-[^/]+\.js(?:\?.*)?$/u, (route) =>
        route.fulfill({
            contentType: "text/javascript",
            body: `const convertToHtml = async () => { globalThis.__docxParserCalls = (globalThis.__docxParserCalls || 0) + 1; throw new Error("DOCX parser boundary reached"); }; export { convertToHtml }; export default { convertToHtml };`,
        }),
    );
    await page.goto("/");
    await waitForAnalysis(page);
    const before = await page.getByLabel("Annotated essay").innerText();
    const title = await page.getByLabel("Essay title").inputValue();
    const input = page.locator('input[type="file"]').first();
    // Prove the parser trap is reachable with an ordinary archive before testing the guard.
    await input.setInputFiles("tests/fixtures/essay.docx");
    await expect(page.getByRole("alert")).toHaveText("DOCX parser boundary reached");
    expect(await page.evaluate(() => Reflect.get(globalThis, "__docxParserCalls"))).toBe(1);
    await page.evaluate(() => Reflect.set(globalThis, "__docxParserCalls", 0));
    await input.setInputFiles({
        name: "dishonest-expansion.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: dishonestCompressedDocx(),
    });
    await expect(page.getByRole("alert")).toHaveText("DOCX decompression exceeds 30 MB.");
    expect(await page.evaluate(() => Reflect.get(globalThis, "__docxParserCalls"))).toBe(0);
    await expect(page.getByLabel("Essay title")).toHaveValue(title);
    await expect(page.getByLabel("Annotated essay")).toHaveText(before);
});

test("extracts mixed HTML text in source order while scripts and subresources remain inert", async ({
    page,
}) => {
    const leaks: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("import-leak")) leaks.push(request.url());
    });
    await page.route("**/*import-leak*", (route) =>
        route.fulfill({ body: "Unexpected imported resource request" }),
    );
    await page.goto("/");
    await waitForAnalysis(page);
    const html = `Lead outside block. <span>Inline lead.</span>
<script>globalThis.__importExecuted = true; fetch("/import-leak/script");</script>
<style>@import url("/import-leak/css"); .secret { background: url("/import-leak/background") }</style>
<link rel="stylesheet" href="/import-leak/stylesheet"><base href="/import-leak/base/">
<img src="/import-leak/image" onerror="globalThis.__importExecuted = true">
<iframe src="/import-leak/frame" srcdoc="<script>parent.__importExecuted=true</script>"></iframe>
<object data="/import-leak/object">Object hidden content.</object>
<svg onload="globalThis.__importExecuted=true"><image href="/import-leak/svg"/></svg>
<math><mtext>Math hidden content.</mtext></math><template>Template hidden content.</template>
<p onclick="globalThis.__importExecuted=true">Paragraph text.</p>
Bridge outside <em>inline bridge.</em><h2>Grammar heading</h2>
<ul><li>List item <strong>with emphasis</strong>.</li></ul>After outside block.`;
    await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
            name: "mixed-safe.html",
            mimeType: "text/html",
            buffer: Buffer.from(html),
        });
    await expect(page.getByLabel("Essay title")).toHaveValue("mixed-safe");
    await expect(page.getByLabel("Annotated essay")).toContainText("After outside block.");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export text" }).click();
    const text = await readFile((await (await downloading).path())!, "utf8");
    const fragments = [
        "Lead outside block. Inline lead.",
        "Paragraph text.",
        "Bridge outside inline bridge.",
        "## Grammar heading",
        "- List item with emphasis.",
        "After outside block.",
    ];
    let previous = -1;
    for (const fragment of fragments) {
        expect(text).toContain(fragment);
        const offset = text.indexOf(fragment);
        expect(offset).toBeGreaterThan(previous);
        previous = offset;
    }
    expect(text).not.toMatch(/import-leak|__importExecuted|hidden content|@import/u);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => Reflect.get(globalThis, "__importExecuted"))).toBeUndefined();
    expect(leaks).toEqual([]);
});
