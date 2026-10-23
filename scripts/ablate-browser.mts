import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPipeline, type AnalysisReport } from "../packages/engine/src/index";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const corpus = JSON.parse(readFileSync("content/regression.json", "utf8")) as {
    cases: { text: string; errors: { rule: string; original: string; correction: string }[] }[];
};
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:4317");
    await page.getByTestId("model-status").filter({ hasText: "Local neural syntax" }).waitFor();
    const worker = readdirSync("apps/web/dist/assets").find((name) =>
        /^analysis.worker-.*\.js$/u.test(name),
    )!;
    const full = await page.evaluate(
        async ({ worker, texts }) => {
            const instance = new Worker(`/assets/${worker}`, { type: "module" });
            const reports: AnalysisReport[] = [];
            try {
                for (const [id, text] of texts.entries())
                    reports.push(
                        await new Promise<AnalysisReport>((resolve, reject) => {
                            const timer = setTimeout(
                                () => reject(new Error("Ablation worker timeout")),
                                30_000,
                            );
                            instance.onmessage = (e) => {
                                clearTimeout(timer);
                                if (e.data.error) reject(new Error(e.data.error));
                                else resolve(e.data.report);
                            };
                            instance.onerror = (e) => {
                                clearTimeout(timer);
                                reject(new Error(e.message));
                            };
                            instance.postMessage({
                                id,
                                text,
                                revision: 0,
                                style: false,
                                assetBase: location.origin + "/",
                            });
                        }),
                    );
                return reports;
            } finally {
                instance.terminate();
            }
        },
        { worker, texts: corpus.cases.map((c) => c.text) },
    );
    if (full.some((r) => r.modelStatus?.state !== "ready"))
        throw new Error("Ablation requires real models for every case.");
    const fallback = createPipeline();
    const variants = {
        rulesOnly: corpus.cases.map((c) => fallback.analyze(c.text)),
        hybridConservative: full.map((r) => ({
            ...r,
            diagnostics: r.diagnostics.filter((d) => d.certainty !== "Possible issue"),
        })),
        hybridReview: full,
        hybridWithoutClassifierFindings: full.map((r) => ({
            ...r,
            diagnostics: r.diagnostics.filter((d) => !d.ruleId.startsWith("model-")),
        })),
        hybridWithoutDictionaryFindings: full.map((r) => ({
            ...r,
            diagnostics: r.diagnostics.filter((d) => d.ruleId !== "dictionary-spelling"),
        })),
    };
    const results = Object.fromEntries(
        Object.entries(variants).map(([name, reports]) => {
            let tp = 0,
                fp = 0,
                fn = 0,
                falseControls = 0,
                spanIntegrity = true;
            reports.forEach((report, i) => {
                const item = corpus.cases[i]!,
                    matched = new Set<number>();
                for (const d of report.diagnostics) {
                    const match = item.errors.findIndex(
                        (e, j) =>
                            !matched.has(j) &&
                            e.rule === d.ruleId &&
                            item.text.slice(d.start, d.end) === e.original,
                    );
                    if (match >= 0) {
                        tp++;
                        matched.add(match);
                    } else fp++;
                    spanIntegrity &&=
                        d.start >= 0 &&
                        d.end >= d.start &&
                        d.end <= item.text.length &&
                        d.proposals.every((p) =>
                            p.edits.every((e) => item.text.slice(e.start, e.end) === e.expected),
                        );
                }
                fn += item.errors.length - matched.size;
                if (!item.errors.length && report.diagnostics.length) falseControls++;
            });
            return [
                name,
                {
                    tp,
                    fp,
                    fn,
                    precision: tp + fp ? tp / (tp + fp) : null,
                    recall: tp + fn ? tp / (tp + fn) : null,
                    falseControls,
                    spanIntegrity,
                },
            ];
        }),
    );
    const report = {
        cases: corpus.cases.length,
        results,
        scope: "Original authored development regression cases; exact rule/span matching; no independent natural-essay accuracy claim",
        method: "Real rules-only and hybrid runs; component-output ablations remove findings without retraining other components, so they do not establish causal training ablations",
    };
    writeFileSync("reports/browser-ablation.json", JSON.stringify(report, null, 4) + "\n");
    console.log(JSON.stringify(report, null, 2));
} finally {
    await browser.close();
}
