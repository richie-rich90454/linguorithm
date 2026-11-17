import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preview } from "vite";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const port = 4318;
const appOrigin = `http://127.0.0.1:${port}`;
if (!existsSync("apps/web/dist/index.html")) {
    console.log("apps/web/dist is missing; building the web application.");
    const build = spawnSync("pnpm", ["--filter", "@grammar/web", "build"], {
        stdio: "inherit",
        shell: true,
    });
    if (build.status !== 0) throw new Error("Web application build failed.");
}

const requests = [];
const externalRequests = [];
const allowed = (url) => {
    if (/^(data|blob):/u.test(url)) return true;
    try {
        return new URL(url).origin === appOrigin;
    } catch {
        return false;
    }
};

const previewServer = await preview({
    configFile: resolve("apps/web/vite.config.ts"),
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port, strictPort: true },
});
let browser;
let offlineReloadRendered = false;
try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("request", (request) => {
        const url = request.url();
        requests.push(url);
        if (!allowed(url)) externalRequests.push(url);
    });
    await page.goto(appOrigin, { waitUntil: "domcontentloaded" });
    const essayNav = page.getByRole("navigation").getByRole("button", { name: "Essay laboratory" });
    await essayNav.waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Edit text" }).click();
    const editor = page.getByRole("textbox", { name: "Essay text" });
    await editor.waitFor({ timeout: 30_000 });
    await editor.fill(
        "The researchers collected water samples from the river and analysed them in the laboratory. Their results were consistent with the earlier measurements.",
    );
    await page.getByRole("button", { name: "Analyze essay" }).click();
    await page
        .getByRole("button", { name: "Analyze again" })
        .or(page.getByText("Review each suggestion, then choose what to keep."))
        .first()
        .waitFor({ timeout: 60_000 });

    // Wait for the offline precache to be ready, then reload online once so the
    // service worker controls the page before the offline reload.
    await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
    if (!(await page.evaluate(() => navigator.serviceWorker?.controller !== null))) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await essayNav.waitFor({ timeout: 30_000 });
        await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
    }

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await essayNav.waitFor({ timeout: 30_000 });
    offlineReloadRendered = await page.evaluate(() => document.body.innerText.trim().length > 0);
    await context.close();
} finally {
    await browser?.close();
    await new Promise((accept, reject) => {
        previewServer.httpServer.close((error) => (error ? reject(error) : accept()));
    });
}

const report = {
    generatedAt: new Date().toISOString(),
    appOrigin,
    requests,
    externalRequests: [...new Set(externalRequests)],
    offlineReloadRendered,
    passed: externalRequests.length === 0 && offlineReloadRendered,
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/offline-verification.json", JSON.stringify(report, null, 4) + "\n");
console.log(
    JSON.stringify(
        {
            path: "reports/offline-verification.json",
            requests: requests.length,
            externalRequests: report.externalRequests,
            offlineReloadRendered,
            passed: report.passed,
        },
        null,
        2,
    ),
);
if (!report.passed) process.exitCode = 1;
