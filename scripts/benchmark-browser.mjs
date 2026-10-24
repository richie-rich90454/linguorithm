import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import os from "node:os";
import { preview } from "vite";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const baseUrl = process.env.BENCHMARK_BROWSER_BASE_URL ?? "http://127.0.0.1:4317";
let previewServer;
try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error("Production preview is unavailable.");
} catch (error) {
    if (process.env.BENCHMARK_BROWSER_BASE_URL) throw error;
    previewServer = await preview({
        configFile: resolve("apps/web/vite.config.ts"),
        root: resolve("apps/web"),
        preview: { host: "127.0.0.1", port: 4317, strictPort: true },
    });
}
let browser;
try {
    browser = await chromium.launch();
    const worker = readdirSync("apps/web/dist/assets").find((name) =>
        /^analysis.worker-.*\.js$/u.test(name),
    );
    async function benchmark(profile, contextOptions) {
        const context = await browser.newContext(contextOptions);
        try {
            const page = await context.newPage();
            await page.goto(baseUrl);
            await page
                .getByTestId("model-status")
                .filter({ hasText: "Local neural syntax" })
                .waitFor();
            const result = await page.evaluate(async (worker) => {
                const instance = new Worker(`/assets/${worker}`, { type: "module" });
                const texts = Array.from(
                    { length: 167 },
                    (_, i) =>
                        `In experiment ${i + 1}, the students reviewed the evidence and discussed their findings with the teacher.`,
                );
                const text = texts.join("\n\n");
                const samples = [];
                try {
                    for (let i = 0; i < 11; i++) {
                        const started = performance.now();
                        const report = await new Promise((resolve, reject) => {
                            const timer = setTimeout(
                                () => reject(new Error("Browser benchmark exceeded 60 seconds")),
                                60_000,
                            );
                            instance.onmessage = (event) => {
                                clearTimeout(timer);
                                if (event.data.error) reject(new Error(event.data.error));
                                else resolve(event.data.report);
                            };
                            instance.onerror = (event) => {
                                clearTimeout(timer);
                                reject(new Error(event.message));
                            };
                            instance.postMessage({
                                id: i,
                                text,
                                revision: i,
                                style: false,
                                assetBase: location.origin + "/",
                            });
                        });
                        if (report.modelStatus?.state !== "ready")
                            throw new Error("Benchmark requires actual local models");
                        samples.push({
                            roundtripMs: performance.now() - started,
                            engineMs: report.elapsedMs,
                            diagnostics: report.diagnostics.length,
                        });
                    }
                    const warm = samples
                        .slice(1)
                        .map((s) => s.roundtripMs)
                        .sort((a, b) => a - b);
                    const navigation = performance.getEntriesByType("navigation")[0];
                    return {
                        words: text.split(/\s+/u).length,
                        sentences: texts.length,
                        samples,
                        coldWorkerMs: samples[0].roundtripMs,
                        warmMs: {
                            p50: warm[Math.floor(warm.length * 0.5)],
                            p95: warm[Math.floor(warm.length * 0.95)],
                        },
                        domInteractiveMs: navigation.domInteractive,
                        userAgent: navigator.userAgent,
                        sampledPageHeapBytes: performance.memory?.usedJSHeapSize ?? null,
                    };
                } finally {
                    instance.terminate();
                }
            }, worker);
            return {
                ...result,
                profile,
                viewport: contextOptions.viewport,
                deviceScaleFactor: contextOptions.deviceScaleFactor ?? 1,
                mobileEmulation: contextOptions.isMobile ?? false,
            };
        } finally {
            await context.close();
        }
    }
    const desktop = await benchmark("desktop Chromium", {
        viewport: { width: 1280, height: 800 },
    });
    const mobile = await benchmark("mobile Chromium emulation", {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
    });
    mkdirSync("reports", { recursive: true });
    const report = {
        desktop,
        mobile,
        cpu: os.cpus()[0]?.model,
        platform: os.platform(),
        limitations:
            "Synthetic distinct numbered paragraphs on desktop Chromium and mobile Chromium emulation; ten warm samples per profile; cold includes local model initialization; DOM interactive excludes full model readiness; page heap sample excludes worker/WASM/native memory and is not peak; physical phone/connection performance unmeasured",
    };
    writeFileSync("reports/browser-performance.json", JSON.stringify(report, null, 4) + "\n");
    console.log(JSON.stringify(report, null, 2));
} finally {
    await browser?.close();
    await new Promise((accept, reject) => {
        if (!previewServer) return accept();
        previewServer.httpServer.close((error) => (error ? reject(error) : accept()));
    });
}
