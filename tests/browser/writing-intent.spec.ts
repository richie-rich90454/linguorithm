import { expect, test } from "@playwright/test";
import { approvePossibleRevision } from "./helpers";

test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Writing intent")).toBeEnabled({ timeout: 30_000 });
});

test("writing intent stays with its draft across analysis and reload", async ({ page }) => {
    const intent = page.getByLabel("Writing intent");
    await intent.selectOption("professional-communication");
    await expect(intent).toHaveValue("professional-communication");
    await expect(page.getByRole("button", { name: "Analyze again" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Writing intent")).toHaveValue("professional-communication");
});

test("progress exposes a general, honest writing-goal map", async ({ page }) => {
    await page.getByRole("button", { name: "Your progress" }).click();
    await page.getByText("Explore writing goals", { exact: true }).click();
    await expect(page.locator(".writing-goal-row")).toHaveCount(100);
    await page.getByLabel("Writing stage").selectOption("advanced");
    await expect(page.locator(".writing-goal-row").first()).toBeVisible();
    await expect(page.locator(".writing-goal-list")).toContainText(
        "Optional surface cue · not independently validated",
    );
    await expect(page.locator(".writing-goal-list")).toContainText(
        "Narrow diagnostic + optional cue · quality gate unmet",
    );
    await expect(page.locator(".writing-goal-list")).not.toContainText("AP English");
});

test("writing evidence cues stay optional and never offer automatic corrections", async ({
    page,
}) => {
    const analyze = () => page.getByRole("button", { name: /Analyze (?:essay|again)/ });
    await page.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Essay text").fill("The survey may suggest a change.");
    await analyze().click();
    await expect(page.getByText("Review a writing cue", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Optional style observations").check();
    await analyze().click();
    const cue = page.locator(".finding-item").filter({ hasText: "Review a writing cue" });
    await expect(cue.first()).toBeVisible({ timeout: 30_000 });
    await expect(cue.first().getByRole("button", { name: "Apply this revision" })).toHaveCount(0);
    await expect(cue.first().locator(".correction-preview")).toContainText(
        "The survey may suggest a change.",
    );
});

test("the production analyzer offers a supported correction for a merged word", async ({
    page,
}) => {
    await page.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Essay text").fill("weshould finish today.");
    await page.getByLabel("Include possible issues").check();
    await page.getByRole("button", { name: "Analyze essay" }).click();
    const finding = page.locator(".finding-item").filter({ hasText: "Separate the words" });
    await expect(finding).toBeVisible({ timeout: 30_000 });
    await expect(finding.locator(".learner-review-prompt")).toBeVisible();
    await approvePossibleRevision(finding);
    await expect(finding.locator(".correction-preview")).toContainText("We should finish today.");
    await expect(finding.getByRole("button", { name: "Apply this revision" })).toBeVisible();
});

test("previously imported materials show source structure on the first visit", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open("syntax-local");
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
                const database = opening.result;
                const transaction = database.transaction("materials", "readwrite");
                transaction.objectStore("materials").put({
                    id: "persisted-material",
                    name: "local-notes.txt",
                    text: "A noun is a word that names a person, place, thing, or idea.",
                    format: "txt",
                    importedAt: "2026-10-24T00:00:00.000Z",
                });
                transaction.oncomplete = () => {
                    database.close();
                    resolve();
                };
                transaction.onerror = () => {
                    database.close();
                    reject(transaction.error);
                };
            };
        });
    });
    await page.reload();
    await page.getByRole("button", { name: "Materials", exact: true }).click();
    await expect(
        page.getByText("Explore source structure · local-notes.txt", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".material-result")).toContainText("1 explicit definitions");
});

test("the production analyzer distinguishes a comma splice from coordinated clauses", async ({
    page,
}) => {
    const boundaryFinding = () =>
        page.locator(".finding-item").filter({
            hasText:
                /(?:Give two clauses a stronger boundary|Check the boundary between independent clauses)/,
        });
    await page.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Essay text").fill("I work hard, she studies daily.");
    await page.getByLabel("Include possible issues").check();
    await page.getByRole("button", { name: "Analyze essay" }).click();
    const splice = boundaryFinding();
    await expect(splice).toBeVisible({ timeout: 30_000 });
    await approvePossibleRevision(splice);
    await expect(splice.locator(".correction-preview")).toContainText(";");
    await expect(splice.locator(".correction-version").nth(0)).toContainText(
        "I work hard, she studies daily.",
    );
    await expect(splice.locator(".correction-version").nth(1)).toContainText(
        "I work hard; she studies daily.",
    );
    await splice.getByRole("button", { name: "Apply this revision" }).click();
    await expect(page.getByLabel("Annotated essay")).toContainText(
        "I work hard; she studies daily.",
    );

    await page.getByRole("button", { name: "Edit text" }).click();
    await page.getByLabel("Essay text").fill("I work hard, and she studies daily.");
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await expect(boundaryFinding()).toHaveCount(0);

    await page.getByRole("button", { name: "Edit text" }).click();
    await page
        .getByLabel("Essay text")
        .fill("The storm damaged the lighthouse, the keeper repaired the lamp.");
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await expect(boundaryFinding()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Edit text" }).click();
    await page
        .getByLabel("Essay text")
        .fill("When the storm damaged the lighthouse, the keeper repaired the lamp.");
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await expect(boundaryFinding()).toHaveCount(0);
});
