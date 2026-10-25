import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");

// The task runner supplies a fresh loopback port so this suite cannot reuse a
// stale preview process from an unrelated app session.
const previewPort = Number(process.env.PLAYWRIGHT_PORT ?? 4317);
if (!Number.isInteger(previewPort) || previewPort < 1)
    throw new Error("Unable to allocate a browser test port.");

export default defineConfig({
    testDir: "./tests/browser",
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    // Loading local WASM models in several browser engines at once exhausts CI runner resources.
    workers: process.env.CI ? 1 : 2,
    reporter: "list",
    timeout: 30_000,
    expect: { timeout: 15_000 },
    use: { baseURL: `http://127.0.0.1:${previewPort}`, trace: "retain-on-failure" },
    webServer: {
        command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${previewPort} --strictPort`,
        url: `http://127.0.0.1:${previewPort}`,
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    ],
});
