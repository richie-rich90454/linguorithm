import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
export default defineConfig({
    testDir: "./tests/browser",
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    workers: 2,
    reporter: "list",
    timeout: 30_000,
    expect: { timeout: 15_000 },
    use: { baseURL: "http://127.0.0.1:4317", trace: "retain-on-failure" },
    webServer: {
        command: "node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4317",
        url: "http://127.0.0.1:4317",
        reuseExistingServer: !process.env.CI,
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    ],
});
