import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("sentence repairs store typed evidence and first-attempt metadata", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Practice", exact: false }).first().click();
    await page.getByRole("button", { name: "Sentence repairs" }).click();
    await page.getByLabel("Your repaired sentence").fill("The collection of essays is ready.");
    await page.getByRole("button", { name: "Check my reasoning" }).click();
    await expect(page.getByRole("heading", { name: "That’s the relationship." })).toBeVisible();
    await page.getByRole("button", { name: "Your progress" }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const backup = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
    expect(backup.version).toBe(2);
    expect(backup.attempts[0]).toMatchObject({
        attemptNumber: 1,
        phase: "practice",
        correct: true,
        responseText: "The collection of essays is ready.",
        difficulty: 2,
    });
    expect(backup.attempts[0].durationMs).toBeGreaterThan(0);
});

test("pretest resumes and completed assessment is isolated from mastery", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Your progress" }).click();
    await page.getByText("Measure retention and transfer", { exact: true }).click();
    await page.getByRole("button", { name: "pretest · Start or resume", exact: true }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Check my reasoning" }).click();
    await expect(page.locator(".answer-feedback")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Your progress" }).click();
    await page.getByText("Measure retention and transfer", { exact: true }).click();
    await page.getByRole("button", { name: "pretest · Start or resume", exact: true }).click();
    await expect(page.locator(".practice-meta")).toContainText("1/5");
    await expect(page.locator(".question-source")).toHaveCount(0);
    for (let i = 1; i < 5; i++) {
        await page.getByRole("radio").first().check();
        await page.getByRole("button", { name: "Check my reasoning" }).click();
        await expect(page.locator(".answer-feedback")).toBeVisible();
        await page.getByRole("button", { name: "Try a new construction" }).click();
    }
    await expect(page.getByRole("heading", { name: "Assessment complete." })).toBeVisible();
    await page.getByRole("button", { name: "Return to adaptive practice" }).click();
    await expect(page.locator(".question-sentence")).toBeVisible();
    await page.getByRole("button", { name: "Your progress" }).click();
    await expect(page.locator(".mastery-value").first()).toContainText("No evidence yet");
});

test("local model preference survives reload with no remote requests", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Engine notes", exact: false }).click();
    await page.getByLabel("Enable local neural models").uncheck();
    await page.getByLabel("Personal dictionary").fill("specializedword\nrecieve");
    await page.getByRole("button", { name: "Save analysis preferences" }).click();
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
    await page.reload();
    await expect(page.getByTestId("model-status")).toHaveText("Deterministic fallback");
    await page.getByRole("button", { name: "Engine notes", exact: false }).click();
    await expect(page.getByLabel("Enable local neural models")).not.toBeChecked();
    await expect(page.getByLabel("Personal dictionary")).toHaveValue("specializedword\nrecieve");
});

test("restoring a newer active document cannot be overwritten by its stale screen state", async ({
    page,
}) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Apply correction" })).toBeVisible();
    await page.getByRole("button", { name: "Your progress" }).click();
    const firstDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const backup = JSON.parse(await readFile((await (await firstDownload).path())!, "utf8"));
    const document = backup.documents[0];
    const at = new Date(Date.now() + 60_000).toISOString();
    document.revisions.push({
        text: "Café 😀 — Students are ready.",
        reason: "Newer restored revision",
        at,
    });
    document.cursor = document.revisions.length - 1;
    document.updatedAt = at;
    await page
        .locator('input[type="file"]')
        .nth(2)
        .setInputFiles({
            name: "newer.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(backup)),
        });
    await page.getByRole("button", { name: "Essay laboratory" }).click();
    await expect(page.getByLabel("Annotated essay")).toHaveText("Café 😀 — Students are ready.");
    await page.getByRole("button", { name: "Your progress" }).click();
    const secondDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const exported = JSON.parse(await readFile((await (await secondDownload).path())!, "utf8"));
    expect(exported.documents[0].revisions.at(-1).text).toBe("Café 😀 — Students are ready.");
});
