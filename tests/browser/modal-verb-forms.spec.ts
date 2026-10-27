import { expect, test } from "@playwright/test";

declare global {
    interface Window {
        __linguorithmLastReport?: {
            diagnostics: readonly { ruleId: string; title: string }[];
            sentences: readonly {
                text: string;
                syntaxSource?: string;
                ambiguous: boolean;
                graph: readonly { head: number; dependent: number; relation: string }[];
                alternatives?: readonly {
                    graph: readonly { head: number; dependent: number; relation: string }[];
                }[];
                tokens: readonly { text: string; pos: string; analyses: readonly unknown[] }[];
            }[];
        };
    }
}

test("the local grammar model checks corpus-attested verb forms after modal auxiliaries", async ({
    page,
}) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
            constructor(...args: ConstructorParameters<typeof Worker>) {
                super(...args);
                this.addEventListener("message", (event) => {
                    const report = (event as MessageEvent).data?.report;
                    if (report)
                        (
                            window as Window & { __linguorithmLastReport?: unknown }
                        ).__linguorithmLastReport = report;
                });
            }
        } as typeof Worker;
    });
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
    await page.getByRole("button", { name: "Edit text" }).click();
    const editor = page.getByLabel("Essay text");
    await editor.fill("She could went home.");
    await page.getByLabel("Include possible issues").check();
    await page.getByRole("button", { name: "Analyze essay" }).click();

    await expect
        .poll(() =>
            page.evaluate(() =>
                window.__linguorithmLastReport?.diagnostics.map((diagnostic) => diagnostic.ruleId),
            ),
        )
        .toContain("neural-modal-form");

    const finding = page
        .locator(".finding-item")
        .filter({ hasText: "Use the base verb after a modal" });
    await expect(finding).toBeVisible({ timeout: 30_000 });
    await expect(finding).toContainText("go");
    await expect(finding.getByRole("button", { name: "Show possible revision" })).toBeVisible();

    await page.getByRole("button", { name: "Edit text" }).click();
    await editor.fill("She could go home.");
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await expect(
        page.locator(".finding-item").filter({ hasText: "Use the base verb after a modal" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Edit text" }).click();
    await editor.fill("They will be examined.");
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await expect
        .poll(() =>
            page.evaluate(() =>
                window.__linguorithmLastReport?.diagnostics
                    .filter((diagnostic) => diagnostic.ruleId === "neural-modal-form")
                    .map((diagnostic) => diagnostic.title),
            ),
        )
        .toEqual([]);
});
