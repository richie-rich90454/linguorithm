import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import os from "node:os";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:4317");
    await page.getByTestId("model-status").filter({ hasText: "Local neural syntax" }).waitFor();
    const worker = readdirSync("apps/web/dist/assets").find((name) =>
        /^analysis.worker-.*\.js$/u.test(name),
    );
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
    mkdirSync("reports", { recursive: true });
    const report = {
        ...result,
        cpu: os.cpus()[0]?.model,
        platform: os.platform(),
        limitations:
            "Synthetic distinct numbered paragraphs on local desktop Chromium; ten warm samples; cold includes model initialization from local cache; DOM interactive excludes full model readiness; page heap sample excludes worker/WASM/native memory and is not peak; physical phone/connection performance unmeasured",
    };
    writeFileSync("reports/browser-performance.json", JSON.stringify(report, null, 4) + "\n");
    console.log(JSON.stringify(report, null, 2));
} finally {
    await browser.close();
}
