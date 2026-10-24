import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("opening an existing workspace repairs factual mastery while preserving real grammar attempts", async ({
    page,
}) => {
    await page.goto("/");
    await expect(page.getByLabel("Essay title")).not.toHaveValue("");
    await page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open("syntax-local");
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
                const database = opening.result;
                const transaction = database.transaction(["skills", "attempts"], "readwrite");
                const at = "2026-10-20T00:00:00.000Z";
                const factualId = "material:old-source:explicit:0";
                for (const [index, exerciseId] of [
                    factualId,
                    "usage-authored-regression",
                ].entries()) {
                    transaction.objectStore("attempts").put({
                        id: `existing-attempt-${index}`,
                        exerciseId,
                        skill: "usage",
                        answer: 0,
                        correct: true,
                        hints: 0,
                        at,
                        phase: "practice",
                        attemptNumber: 1,
                    });
                }
                transaction.objectStore("skills").put({
                    skill: "usage",
                    mastery: 0.95,
                    attempts: 2,
                    correct: 2,
                    due: at,
                    interval: 3,
                    lastExercise: factualId,
                });
                transaction.oncomplete = () => {
                    database.close();
                    resolve();
                };
                transaction.onabort = () => {
                    database.close();
                    reject(transaction.error);
                };
            };
        });
    });
    await page.reload();
    await expect(page.getByLabel("Essay title")).not.toHaveValue("");
    await page.getByRole("button", { name: "Your progress" }).click();
    await expect(
        page.locator(".mastery-row").filter({ hasText: "Spelling and usage" }),
    ).toContainText("1 attempts");
    await expect(page.locator(".attempt-list > div")).toHaveCount(2);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const backup = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
    expect(backup.skills).toHaveLength(1);
    expect(backup.skills[0]).toMatchObject({
        skill: "usage",
        attempts: 1,
        correct: 1,
        lastExercise: "usage-authored-regression",
    });
    expect(backup.skills[0].mastery).toBeLessThan(0.95);
    expect(backup.attempts).toHaveLength(2);
});

test("factual source recall is recorded without increasing grammar mastery, including after restore", async ({
    page,
}) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Materials", exact: true }).click();
    await page
        .locator('input[type="file"]')
        .nth(1)
        .setInputFiles({
            name: "facts.txt",
            mimeType: "text/plain",
            buffer: Buffer.from(
                "Alpha means a small red fruit.\nBeta means a tall green tree.\nGamma means a large blue planet.",
            ),
        });
    await page.getByRole("button", { name: "Practice 3 questions" }).click();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Check my reasoning" }).click();
    await expect(page.locator(".answer-feedback")).toBeVisible();
    await page.getByRole("button", { name: "Your progress" }).click();
    await expect(
        page.locator(".mastery-value").filter({ hasNotText: "No evidence yet" }),
    ).toHaveCount(0);
    await expect(page.locator(".progress-summary > div").nth(1)).toContainText(
        "0 answers without a hint",
    );
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const backup = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
    expect(backup.attempts).toHaveLength(1);
    expect(backup.attempts[0].exerciseId).toContain(":explicit:");
    expect(backup.skills).toEqual([]);
    backup.attempts[0].id = "restored-factual-response";
    backup.skills = [
        {
            skill: "usage",
            mastery: 0.9,
            attempts: 1,
            correct: 1,
            due: new Date().toISOString(),
            interval: 1,
            lastExercise: backup.attempts[0].exerciseId,
        },
    ];
    await page
        .locator('input[type="file"]')
        .nth(2)
        .setInputFiles({
            name: "facts-backup.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(backup)),
        });
    await expect(page.locator(".attempt-list > div")).toHaveCount(2);
    await expect(
        page.locator(".mastery-value").filter({ hasNotText: "No evidence yet" }),
    ).toHaveCount(0);
});

test("an answered assessment survives a visit to progress without asking for a duplicate answer", async ({
    page,
}) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Your progress" }).click();
    await page.getByText("Measure retention and transfer", { exact: true }).click();
    await page.getByRole("button", { name: "pretest · Start or resume", exact: true }).click();
    const first = await page.locator(".question-sentence").textContent();
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Check my reasoning" }).click();
    await expect(page.locator(".answer-feedback")).toBeVisible();
    await page.getByRole("button", { name: "Your progress" }).click();
    await page
        .getByRole("navigation")
        .getByRole("button", { name: "Practice", exact: true })
        .click();
    await expect(page.locator(".answer-feedback")).toBeVisible();
    await expect(page.locator(".practice-meta")).toContainText("1/5");
    await page.getByRole("button", { name: "Try a new construction" }).click();
    await expect(page.locator(".question-sentence")).not.toHaveText(first!);
    await expect(page.getByRole("button", { name: "Check my reasoning" })).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
});

test("practice keeps typed repair and hint evidence while visiting another page", async ({
    page,
}) => {
    await page.goto("/");
    await page
        .getByRole("navigation")
        .getByRole("button", { name: "Practice", exact: true })
        .click();
    await page.getByRole("button", { name: "Sentence repairs" }).click();
    await page.getByLabel("Your repaired sentence").fill("The collection of essays is ready.");
    await page.getByRole("button", { name: "Give me a hint", exact: true }).click();
    await page.getByRole("button", { name: "Your progress" }).click();
    await page
        .getByRole("navigation")
        .getByRole("button", { name: "Practice", exact: true })
        .click();
    await expect(page.getByLabel("Your repaired sentence")).toHaveValue(
        "The collection of essays is ready.",
    );
    await expect(page.locator(".hint-box")).toContainText("Hint 1");
    await page.getByRole("button", { name: "Check my reasoning" }).click();
    await expect(page.locator(".answer-feedback")).toContainText(
        "A hinted answer is recorded separately",
    );
});

test("a blank new essay cancels analysis belonging to the previous document", async ({ page }) => {
    await page.addInitScript(() => {
        const pending: (() => void)[] = [];
        Object.assign(window, {
            finishPendingAnalysis: () => pending.splice(0).forEach((finish) => finish()),
        });
        window.Worker = class {
            onmessage?: (event: MessageEvent) => void;
            terminated = false;
            postMessage(input: { id: number; text: string; revision: number }) {
                pending.push(() => {
                    if (!this.terminated)
                        this.onmessage?.(
                            new MessageEvent("message", {
                                data: {
                                    id: input.id,
                                    report: {
                                        text: input.text,
                                        revision: input.revision,
                                        sentences: [],
                                        diagnostics: [],
                                        elapsedMs: 1,
                                        cachedParagraphs: 0,
                                        versions: {},
                                        limitations: [],
                                    },
                                },
                            }),
                        );
                });
            }
            terminate() {
                this.terminated = true;
            }
        } as unknown as typeof Worker;
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Cancel analysis" })).toBeVisible();
    await page.getByRole("button", { name: "New essay", exact: true }).click();
    await expect(page.getByLabel("Essay title")).toHaveValue("Untitled essay");
    await page.evaluate(() =>
        (window as unknown as { finishPendingAnalysis: () => void }).finishPendingAnalysis(),
    );
    await expect(page.getByLabel("Essay text")).toBeVisible();
    await expect(page.getByLabel("Essay text")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Cancel analysis" })).toHaveCount(0);
});
