import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPipeline } from "../packages/engine/src/index";

interface Corpus {
    version: string;
    provenance: string;
    cases: {
        text: string;
        errors: { rule: string; original: string; correction: string; start?: number }[];
    }[];
}
const path = process.argv[2] ?? "content/regression.json";
const corpus = JSON.parse(readFileSync(path, "utf8")) as Corpus;
const pipeline = createPipeline();
const categories = new Map<string, { tp: number; fp: number; fn: number; correct: number }>();
const counts = (rule: string) => {
    let c = categories.get(rule);
    if (!c) {
        c = { tp: 0, fp: 0, fn: 0, correct: 0 };
        categories.set(rule, c);
    }
    return c;
};
let validControls = 0,
    falseControls = 0,
    integrity = true;
const latency: number[] = [];
for (const item of corpus.cases) {
    const report = pipeline.analyze(item.text);
    latency.push(report.elapsedMs);
    const matched = new Set<number>();
    if (!item.errors.length) {
        validControls++;
        if (report.diagnostics.length) falseControls++;
    }
    for (const d of report.diagnostics) {
        const index = item.errors.findIndex(
            (e, i) =>
                !matched.has(i) &&
                e.rule === d.ruleId &&
                item.text.slice(d.start, d.end) === e.original &&
                (e.start === undefined || e.start === d.start),
        );
        const c = counts(d.ruleId);
        if (index < 0) c.fp++;
        else {
            c.tp++;
            matched.add(index);
            if (d.proposals.some((p) => p.edits[0]?.replacement === item.errors[index]!.correction))
                c.correct++;
        }
        integrity &&=
            d.start >= 0 &&
            d.end <= item.text.length &&
            d.proposals.every((p) =>
                p.edits.every((e) => item.text.slice(e.start, e.end) === e.expected),
            );
    }
    item.errors.forEach((e, i) => {
        if (!matched.has(i)) counts(e.rule).fn++;
    });
}
const metrics = [...categories].map(([rule, c]) => {
    const interval = (successes: number, total: number) => {
        if (!total) return null;
        const z = 1.96,
            p = successes / total,
            denominator = 1 + (z * z) / total,
            center = (p + (z * z) / (2 * total)) / denominator,
            half =
                (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
                denominator;
        return {
            lower: Math.max(0, center - half),
            upper: Math.min(1, center + half),
            method: "Wilson 95%",
        };
    };
    const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null,
        recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
    return {
        rule,
        ...c,
        precision,
        recall,
        precisionInterval: interval(c.tp, c.tp + c.fp),
        recallInterval: interval(c.tp, c.tp + c.fn),
        independentReleaseGate: false,
        f05:
            precision !== null && recall !== null && precision + recall > 0
                ? (1.25 * precision * recall) / (0.25 * precision + recall)
                : null,
        correctionAccuracy: c.tp ? c.correct / c.tp : null,
    };
});
latency.sort((a, b) => a - b);
const result = {
    dataset: path,
    version: corpus.version,
    provenance: corpus.provenance,
    cases: corpus.cases.length,
    validControls,
    falseControls,
    falseControlRate: validControls ? falseControls / validControls : null,
    spanIntegrity: integrity,
    metrics,
    latencyMs: {
        p50: latency[Math.floor(latency.length * 0.5)],
        p95: latency[Math.floor(latency.length * 0.95)],
    },
    memoryBytes: process.memoryUsage().heapUsed,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    warning:
        "Development smoke corpus only. Does not establish release precision, generalization, calibration, or comparative performance.",
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/evaluation.json", JSON.stringify(result, null, 4) + "\n");
console.log(JSON.stringify(result, null, 2));
if (!integrity || metrics.some((m) => m.fp > 0 || m.fn > 0 || m.correct < m.tp))
    process.exitCode = 1;
