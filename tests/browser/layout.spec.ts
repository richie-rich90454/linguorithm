import { expect, test } from "@playwright/test";

for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
]) {
    test(`desktop reading controls stay reachable at ${viewport.width} by ${viewport.height}`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Apply correction" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Analyze again" })).toBeInViewport({
            ratio: 1,
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        await page.getByRole("button", { name: "Edit text", exact: false }).click();
        await expect(page.getByLabel("Essay text")).toBeInViewport();
        await expect(page.getByRole("button", { name: "Analyze again" })).toBeInViewport();
    });
}
