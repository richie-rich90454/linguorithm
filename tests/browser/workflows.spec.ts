import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { approvePossibleRevision, waitForAnalysis } from "./helpers";

test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForAnalysis(page);
});
test("source-linked correction, undo, persistence, and structure", async ({ page }) => {
    await expect(page.getByLabel("Annotated essay")).toContainText("details are often");
    await expect(page.locator(".finding-detail")).toContainText(
        "Essay findings have not met independent learner-writing accuracy gates.",
    );
    await expect(page.locator(".correction-preview")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apply this revision" })).toHaveCount(0);
    await expect(page.locator(".learner-review-prompt")).toContainText("Try your own revision");
    await page.getByRole("button", { name: "Show possible revision" }).click();
    const applyRevision = page.getByRole("button", { name: "Apply this revision" });
    await expect(applyRevision).toBeDisabled();
    await page.getByRole("checkbox", { name: "I checked that this preserves my meaning" }).check();
    await expect(applyRevision).toBeEnabled();
    await expect(page.locator(".finding-detail")).toContainText(
        "Your text changes only when you choose an edit.",
    );
    await page.getByRole("button", { name: "Apply this revision" }).click();
    await expect(page.getByLabel("Annotated essay")).toContainText("details is often");
    await page.getByRole("button", { name: "Undo change" }).click();
    await expect(page.getByLabel("Annotated essay")).toContainText("details are often");
    await page.getByRole("button", { name: "Redo change" }).click();
    await expect(page.getByLabel("Annotated essay")).toContainText("details is often");
    await expect(page.locator(".save-status")).toContainText(/saved on this device/i);
    await page.reload();
    await expect(page.getByLabel("Annotated essay")).toContainText("details is often");
    await page.getByRole("button", { name: "Sentence workbench" }).click();
    await expect(
        page.getByRole("heading", { name: "Sentence workbench", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".dependency-diagram")).toBeVisible();
});

test("analysis and dismissal preserve the draft until an edit is accepted", async ({ page }) => {
    const original = "She has wrote a detailed report.";
    await page.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Essay text").fill(original);
    await page.getByRole("button", { name: "Analyze essay" }).click();
    const finding = page.locator(".finding-item").filter({ hasText: "Check the verb form" });
    await expect(finding).toBeVisible();
    await expect(page.getByLabel("Annotated essay")).toHaveText(original);
    await finding
        .getByRole("button", { name: "Dismiss Check the verb form; keep your wording" })
        .click();
    await expect(page.getByLabel("Annotated essay")).toHaveText(original);
    await page.reload();
    await expect(page.getByLabel("Annotated essay")).toHaveText(original);
});
test("practice records one first attempt and reveals explanation", async ({ page }) => {
    await page.getByRole("button", { name: "Practice", exact: false }).first().click();
    await expect(page.locator(".answer-option").first()).toBeVisible();
    await page.getByRole("button", { name: "Give me a hint", exact: true }).click();
    await expect(page.locator(".hint-box")).toBeVisible();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Check my reasoning" }).click();
    await expect(page.locator(".answer-feedback")).toBeVisible();
    await page.getByRole("button", { name: "Your progress" }).click();
    await expect(page.locator(".progress-summary").first()).toContainText("1");
    await expect(page.locator(".attempt-list>div")).toHaveCount(1);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const path = await (await downloading).path();
    const backup = JSON.parse(await readFile(path!, "utf8"));
    expect(backup.format).toBe("syntax-backup");
    expect(backup.attempts).toHaveLength(1);
});
test("safe material import, grounded quiz and empty material abstention", async ({ page }) => {
    const leaks: string[] = [];
    page.on("request", (r) => {
        if (r.url().includes("import-leak")) leaks.push(r.url());
    });
    await page.getByRole("button", { name: "Materials", exact: false }).click();
    await page
        .locator('input[type="file"]')
        .nth(1)
        .setInputFiles({
            name: "lesson.html",
            mimeType: "text/html",
            buffer: Buffer.from(
                '<script>window.pwned=true</script><img src="/import-leak?essay=private"><iframe src="/import-leak"></iframe><p>A noun is a word that names a person, place, thing, or idea.</p>',
            ),
        });
    await expect(page.getByRole("button", { name: "Practice 1 questions" })).toBeVisible();
    expect(await page.evaluate(() => "pwned" in window)).toBe(false);
    expect(leaks).toEqual([]);
    await page.getByRole("button", { name: "Practice 1 questions" }).click();
    await expect(page.locator(".question-sentence")).toContainText("names a person");
    await page.locator(".question-source summary").click();
    await expect(page.locator(".question-source")).toContainText("lesson.html");
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Check my reasoning" }).click();
    await expect(page.locator(".answer-feedback")).toBeVisible();
    await page.getByRole("button", { name: "Try a new construction" }).click();
    await expect(
        page.getByRole("heading", { name: "You’ve completed this source quiz." }),
    ).toBeVisible();
});

test("DOCX and PDF extraction, scanned-page abstention", async ({ page }) => {
    for (const extension of ["docx", "pdf"]) {
        await page
            .locator('input[type="file"]')
            .first()
            .setInputFiles(`tests/fixtures/essay.${extension}`);
        await expect(page.getByLabel("Essay title")).toHaveValue("essay");
        await expect(page.getByLabel("Annotated essay")).toContainText("She has wrote an essay.");
        await expect(page.getByRole("button", { name: "Show possible revision" })).toBeVisible();
        await approvePossibleRevision(page.locator(".finding-detail"));
        await page.getByRole("button", { name: "Apply this revision" }).click();
        await expect(page.getByLabel("Annotated essay")).toContainText("She has written an essay.");
    }
    await page.locator('input[type="file"]').first().setInputFiles("tests/fixtures/blank.pdf");
    await expect(page.getByRole("alert")).toContainText("no readable text");
    await expect(page.getByLabel("Annotated essay")).toContainText("She has written an essay.");
});

test("valid backup restore preserves Unicode and invalid backup leaves documents intact", async ({
    page,
}) => {
    const timestamp = new Date().toISOString();
    const backup = {
        format: "syntax-backup",
        version: 1,
        exportedAt: timestamp,
        documents: [
            {
                id: "restored-1",
                title: "Restored Unicode",
                revisions: [
                    {
                        text: "Café 😀 — She has written an essay.",
                        reason: "Original",
                        at: timestamp,
                    },
                ],
                cursor: 0,
                updatedAt: timestamp,
            },
        ],
        skills: [],
        attempts: [],
        materials: [],
    };
    await page
        .locator('input[type="file"]')
        .nth(2)
        .setInputFiles({
            name: "backup.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(backup)),
        });
    await expect(
        page
            .getByLabel("Current document")
            .locator("option")
            .filter({ hasText: "Restored Unicode" }),
    ).toHaveCount(1);
    await page.getByLabel("Current document").selectOption("restored-1");
    await expect(page.getByLabel("Annotated essay")).toContainText("Café 😀");
    await expect(page.getByLabel("Essay title")).toHaveValue("Restored Unicode");
});
test("keyboard accessibility, no external requests and narrow layout", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
        if (/^https?:/u.test(r.url()) && !r.url().startsWith("http://127.0.0.1:4317"))
            external.push(r.url());
    });
    const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
    expect(results.violations).toEqual([]);
    await page.getByRole("button", { name: "Engine notes" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Restore backup" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close settings" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
    );
    expect(external).toEqual([]);
});
test("text import and backup export/restore validation", async ({ page }) => {
    await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
            name: "my-essay.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("She has wrote an essay. 😀"),
        });
    await expect(page.getByLabel("Annotated essay")).toContainText("She has wrote");
    await expect(page.getByLabel("Essay title")).toHaveValue("my-essay");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export text" }).click();
    expect((await downloading).suggestedFilename()).toBe("my-essay.txt");
    await page
        .locator('input[type="file"]')
        .nth(2)
        .setInputFiles({
            name: "bad.json",
            mimeType: "application/json",
            buffer: Buffer.from('{"format":"wrong"}'),
        });
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Annotated essay")).toContainText("She has wrote");
});
test("cached shell and essay remain available offline", async ({ page, context }) => {
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.getByLabel("Annotated essay")).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByLabel("Annotated essay")).toContainText("Good writing begins");
    await page.getByRole("button", { name: "Analyze again" }).click();
    await waitForAnalysis(page);
});
