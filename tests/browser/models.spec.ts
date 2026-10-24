import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

test("real local models initialize and browser emissions match Python ONNX", async ({
    page,
}, info) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
    const worker = readdirSync("apps/web/dist/assets").find((name) =>
        /^analysis.worker-.*\.js$/u.test(name),
    )!;
    const fixtures = JSON.parse(readFileSync("apps/web/public/models/parity.json", "utf8")).slice(
        0,
        5,
    ) as { words: number[]; chars: number[][]; emissions: number[][] }[];
    const result = await page.evaluate(
        async ({ worker, inputs }) => {
            const instance = new Worker(`/assets/${worker}`, { type: "module" });
            try {
                return await new Promise<{ emissions?: number[][]; error?: string }>(
                    (resolve, reject) => {
                        const timer = setTimeout(
                            () => reject(new Error("Browser model parity timeout")),
                            40_000,
                        );
                        instance.onmessage = (event) => {
                            clearTimeout(timer);
                            resolve(event.data);
                        };
                        instance.onerror = (event) => {
                            clearTimeout(timer);
                            reject(new Error(event.message));
                        };
                        instance.postMessage({
                            id: 1,
                            type: "parity",
                            inputs,
                            assetBase: location.origin + "/",
                        });
                    },
                );
            } finally {
                instance.terminate();
            }
        },
        { worker, inputs: fixtures.map((f) => ({ words: f.words, chars: f.chars })) },
    );
    expect(result.error).toBeUndefined();
    let maximumDifference = 0;
    for (let i = 0; i < fixtures.length; i++) {
        const reference = fixtures[i]!.emissions.flat(),
            actual = result.emissions![i]!;
        expect(actual).toHaveLength(reference.length);
        for (let j = 0; j < reference.length; j++)
            maximumDifference = Math.max(maximumDifference, Math.abs(reference[j]! - actual[j]!));
    }
    expect(maximumDifference).toBeLessThan(0.0002);
    mkdirSync("reports", { recursive: true });
    writeFileSync(
        `reports/browser-parity-${info.project.name}.json`,
        JSON.stringify(
            {
                browser: info.project.name,
                fixtures: fixtures.length,
                maximumDifference,
                passed: true,
            },
            null,
            4,
        ) + "\n",
    );
});

test("model failure remains explicit while deterministic analysis works", async ({ page }) => {
    await page.route("**/models/registry.json", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
    await expect(page.getByRole("button", { name: "Apply correction" })).toBeVisible();
});

test.describe("model integrity", () => {
    test.use({ serviceWorkers: "block" });

    test("corrupted model metadata fails integrity checking", async ({ page, context }) => {
        let corruptedRequestObserved = false;
        await context.route(/\/models\/lexicon\.json\?/u, async (route) => {
            corruptedRequestObserved = true;
            await route.fulfill({
                contentType: "application/json",
                body: '{"forms":{},"frequency":{}}',
            });
        });
        await page.goto("/");
        await expect.poll(() => corruptedRequestObserved).toBe(true);
        await expect(page.getByText(/Integrity check failed/u)).toBeVisible();
        await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
        await page.getByRole("button", { name: "Engine notes", exact: false }).click();
        await expect(page.getByRole("dialog")).toContainText("Integrity check failed");
    });
});

test("cached neural models initialize after an offline reload", async ({ page, context }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
});
