import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");

mkdirSync("reports", { recursive: true });
const browser = await chromium.launch({ headless: true });
const previewUrl = process.argv[2] ?? "http://127.0.0.1:4317";
const previewOrigin = new URL(previewUrl).origin;
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const runtimeErrors = [],
    externalRequests = [],
    reviews = [];
page.on("pageerror", (e) => runtimeErrors.push(e.message));
page.on("request", (r) => {
    if (/^https?:/u.test(r.url()) && new URL(r.url()).origin !== previewOrigin)
        externalRequests.push(r.url());
});
try {
    await page.goto(previewUrl);
    await page.getByRole("button", { name: "Apply correction" }).waitFor();
    for (const [name, label] of [
        ["desktop", "Essay laboratory"],
        ["workbench", "Sentence workbench"],
        ["practice", "Practice"],
        ["materials", "Materials"],
        ["progress", "Your progress"],
    ]) {
        await page.getByRole("navigation").getByRole("button", { name: label }).click();
        const violations = (
            await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
        ).violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            targets: v.nodes.map((n) => n.target),
        }));
        await page.screenshot({ path: `reports/interface-${name}.png`, fullPage: true });
        if (name === "desktop")
            copyFileSync("reports/interface-desktop.png", "docs/images/workspace.png");
        reviews.push({
            page: label,
            width: 1440,
            violations,
            horizontalOverflow: await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
        });
    }
    await page.getByRole("navigation").getByRole("button", { name: "Essay laboratory" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const violations = (
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
    ).violations.map((v) => ({ id: v.id, impact: v.impact }));
    await page.screenshot({ path: "reports/interface-mobile.png", fullPage: true });
    reviews.push({
        page: "Mobile essay",
        width: 390,
        violations,
        horizontalOverflow: await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
        ),
    });
    const result = { reviews, runtimeErrors, externalRequests };
    writeFileSync("reports/interface-review.json", JSON.stringify(result, null, 4) + "\n");
    console.log(JSON.stringify(result, null, 2));
    if (
        runtimeErrors.length ||
        externalRequests.length ||
        reviews.some((r) => r.violations.length || r.horizontalOverflow)
    )
        process.exitCode = 1;
} finally {
    await browser.close();
}
