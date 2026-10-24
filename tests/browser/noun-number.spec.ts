import { expect, test } from "@playwright/test";

test("the production local parser reviews count noun number without rewriting the draft", async ({
    page,
}) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.getByTestId("model-status")).toHaveText("Local neural syntax · ewt-1", {
        timeout: 30_000,
    });
    await page.getByRole("button", { name: "Edit text" }).click();
    const editor = page.getByLabel("Essay text");
    await editor.fill("We saw three dog on the trail.");
    await page.getByLabel("Include possible issues").check();
    await page.getByRole("button", { name: "Analyze essay" }).click();

    const finding = page
        .locator(".finding-item")
        .filter({ hasText: "Review the noun form after a plural quantity" });
    await expect(finding).toBeVisible({ timeout: 30_000 });
    await expect(finding).toContainText("three");
    await expect(finding).toContainText("dog");
    await expect(finding.getByRole("button", { name: "Apply correction" })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit text" }).click();
    await expect(editor).toHaveValue("We saw three dog on the trail.");

    await editor.fill("We saw three dogs on the trail.");
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await expect(
        page
            .locator(".finding-item")
            .filter({ hasText: "Review the noun form after a plural quantity" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Edit text" }).click();
    await editor.fill("The traders scheduled a 430 call to wrap it up.");
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await expect(
        page
            .locator(".finding-item")
            .filter({ hasText: "Review the noun form after a plural quantity" }),
    ).toHaveCount(0);
});
