import { expect, type Locator, type Page } from "@playwright/test";

export async function approvePossibleRevision(scope: Page | Locator): Promise<void> {
    await scope.getByRole("button", { name: "Show possible revision" }).click();
    await scope.getByRole("checkbox", { name: "I checked that this preserves my meaning" }).check();
}

export async function waitForAnalysis(page: Page): Promise<void> {
    await expect(page.getByRole("button", { name: "Analyze again" })).toBeVisible({
        timeout: 30_000,
    });
}
