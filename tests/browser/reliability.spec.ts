import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function storedRecords(page: Page, store: string): Promise<Record<string, unknown>[]> {
    return page.evaluate(
        (name) =>
            new Promise<Record<string, unknown>[]>((resolve, reject) => {
                const opening = indexedDB.open("syntax-local");
                opening.onerror = () => reject(opening.error);
                opening.onsuccess = () => {
                    const database = opening.result;
                    const request = database.transaction(name).objectStore(name).getAll();
                    request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
                    request.onerror = () => reject(request.error);
                    database.close();
                };
            }),
        store,
    );
}

test("an additive restore rejects an oversized merged collection without changing local records", async ({
    page,
}) => {
    await page.route("**/models/registry.json", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
    const record = (index: number, title = `Stored essay ${index}`) => ({
        id: `capacity-document-${index}`,
        title,
        updatedAt: "2026-10-23T00:00:00.000Z",
        revisions: [
            { text: "Students are ready.", reason: "Original", at: "2026-10-23T00:00:00.000Z" },
        ],
        cursor: 0,
    });
    const backup = (documents: ReturnType<typeof record>[]) => ({
        format: "syntax-backup",
        version: 2,
        exportedAt: "2026-10-23T00:00:00.000Z",
        documents,
        materials: [],
        attempts: [],
        skills: [],
    });
    await page
        .locator('input[type="file"]')
        .nth(2)
        .setInputFiles({
            name: "at-capacity.json",
            mimeType: "application/json",
            buffer: Buffer.from(
                JSON.stringify(backup(Array.from({ length: 99 }, (_, index) => record(index)))),
            ),
        });
    await expect
        .poll(async () => (await storedRecords(page, "documents")).length)
        .toBeGreaterThanOrEqual(99);
    const beforeRestore = await storedRecords(page, "documents");
    await page
        .locator('input[type="file"]')
        .nth(2)
        .setInputFiles({
            name: "over-capacity.json",
            mimeType: "application/json",
            buffer: Buffer.from(
                JSON.stringify(
                    backup([
                        {
                            ...record(0, "This update must not be committed"),
                            updatedAt: "2026-10-24T00:00:00.000Z",
                        },
                        record(99),
                        record(100),
                    ]),
                ),
            ),
        });
    await expect(page.getByRole("alert")).toContainText("limit of 100 documents");
    await expect(page.getByRole("alert")).toContainText("No backup records were restored.");
    await page.getByRole("button", { name: "Your progress" }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const result = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
    expect(result.documents).toHaveLength(beforeRestore.length);
    expect(
        result.documents.find((document: { id: string }) => document.id === "capacity-document-0")
            .title,
    ).toBe("Stored essay 0");
    expect(
        result.documents.some((document: { id: string }) =>
            ["capacity-document-99", "capacity-document-100"].includes(document.id as string),
        ),
    ).toBe(false);
});

test("the same analysis worker retries a transient model initialization failure", async ({
    page,
}) => {
    test.setTimeout(60_000);
    let fail = true;
    await page.route("**/models/registry.json", (route) =>
        fail ? route.abort() : route.continue(),
    );
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
    fail = false;
    await page.getByRole("button", { name: "Analyze again" }).click();
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
});

test("a corrupted download is rejected without poisoning the next model retry", async ({
    page,
}) => {
    test.setTimeout(60_000);
    let corrupt = true;
    await page.route("**/models/lexicon.json?*", (route) =>
        corrupt
            ? route.fulfill({
                  contentType: "application/json",
                  body: '{"forms":{},"frequency":{}}',
              })
            : route.continue(),
    );
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
    const cached = await page.evaluate(async () => {
        const cache = await caches.open("syntax-verified-models-v3");
        return (await cache.keys()).some((key) =>
            new URL(key.url).pathname.endsWith("lexicon.json"),
        );
    });
    expect(cached).toBe(false);
    corrupt = false;
    await page.getByRole("button", { name: "Analyze again" }).click();
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
});

test("online model discovery replaces stale registry data and ignores legacy filename caches", async ({
    page,
}) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        const legacy = await caches.open("syntax-models-ewt-1");
        await legacy.put(new URL("models/lexicon.json", location.href), new Response("stale"));
        const discovery = await caches.open("syntax-model-discovery-v2");
        await discovery.put(new URL("models/registry.json", location.href), new Response("stale"));
    });
    await page.reload();
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
    const cacheState = await page.evaluate(async () => {
        const registry = await (
            await caches.open("syntax-model-discovery-v2")
        ).match(new URL("models/registry.json", location.href));
        const keys = await (await caches.open("syntax-verified-models-v3")).keys();
        return {
            registry: await registry?.text(),
            hashes: keys.map((key) => new URL(key.url).searchParams.get("sha256")),
        };
    });
    expect(JSON.parse(cacheState.registry ?? "null")).toMatchObject({
        schemaVersion: 2,
        version: "ewt-1",
    });
    expect(cacheState.hashes.length).toBeGreaterThan(5);
    expect(cacheState.hashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash ?? ""))).toBe(true);
});

test("additive restore compares actual timestamps and replays attempts chronologically", async ({
    page,
}) => {
    await page.route("**/models/registry.json", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
    const backup = (newer: boolean) => ({
        format: "syntax-backup",
        version: 2,
        exportedAt: "2026-10-23T00:00:00.000Z",
        documents: [
            {
                id: "restore-timestamp-test",
                title: newer ? "Newer retained title" : "Older imported title",
                updatedAt: newer ? "2026-10-20T00:00:00.500Z" : "2026-10-20T00:00:00Z",
                revisions: [
                    { text: "Students are ready.", reason: "Original", at: "2026-10-20T00:00:00Z" },
                ],
                cursor: 0,
            },
        ],
        skills: [],
        attempts: [
            {
                id: newer ? "later-attempt" : "earlier-attempt",
                exerciseId: "agreement-1",
                skill: "agreement",
                answer: 1,
                correct: true,
                hints: 0,
                phase: "practice",
                attemptNumber: 1,
                at: newer ? "2026-10-20T00:00:00.500Z" : "2026-10-20T00:00:00Z",
            },
        ],
        materials: [],
        models: [
            {
                id: "merge-check",
                version: newer ? "current-model" : "stale-model",
                status: "ready",
                detail: "Restore timestamp regression",
                at: newer ? "2026-10-23T00:00:00Z" : "2026-10-22T00:00:00Z",
            },
        ],
    });
    for (const newer of [true, false]) {
        await page
            .locator('input[type="file"]')
            .nth(2)
            .setInputFiles({
                name: newer ? "newer.json" : "older.json",
                mimeType: "application/json",
                buffer: Buffer.from(JSON.stringify(backup(newer))),
            });
        await expect
            .poll(async () =>
                (await storedRecords(page, "attempts")).some(
                    (attempt) => attempt.id === (newer ? "later-attempt" : "earlier-attempt"),
                ),
            )
            .toBe(true);
    }
    await page.getByRole("button", { name: "Your progress" }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const result = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
    expect(
        result.documents.find(
            (document: { id: string }) => document.id === "restore-timestamp-test",
        ).title,
    ).toBe("Newer retained title");
    expect(result.models.find((model: { id: string }) => model.id === "merge-check").version).toBe(
        "current-model",
    );
    expect(
        result.attempts.find((attempt: { id: string }) => attempt.id === "earlier-attempt")
            .attemptNumber,
    ).toBe(1);
    expect(
        result.attempts.find((attempt: { id: string }) => attempt.id === "later-attempt")
            .attemptNumber,
    ).toBe(2);
});
