import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "oxfmt";
import { preview } from "vite";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const inputPath = ".cache/datasets/realec/benchmark.json";
const manifestPath = "training/datasets/realec-manifest.json";
const reportPath = "reports/realec-independent-evaluation.json";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const wilson = (successes, total) => {
    if (!total) return null;
    const z = 1.959963984540054,
        p = successes / total,
        denominator = 1 + (z * z) / total,
        center = (p + (z * z) / (2 * total)) / denominator,
        half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
    return [Math.max(0, center - half), Math.min(1, center + half)];
};
const ratios = ({ TP, FP, FN, TN }) => {
    const precision = TP + FP ? TP / (TP + FP) : null,
        recall = TP + FN ? TP / (TP + FN) : null,
        falsePositiveRate = FP + TN ? FP / (FP + TN) : null;
    return {
        precision,
        recall,
        f0_5:
            precision !== null && recall !== null && precision + recall > 0
                ? (1.25 * precision * recall) / (0.25 * precision + recall)
                : null,
        falsePositiveRate,
        precisionWilson95: wilson(TP, TP + FP),
        recallWilson95: wilson(TP, TP + FN),
        falsePositiveRateWilson95: wilson(FP, FP + TN),
    };
};
const sourceTokens = (text) =>
    [...text.matchAll(/[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|[^\s]/gu)].map((match) => ({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
    }));

function markSpan(tokens, flags, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start)
        return false;
    let found = false;
    if (start === end) {
        const next = tokens.findIndex((token) => token.start >= start);
        const index = next >= 0 ? next : tokens.length - 1;
        if (index >= 0) flags[index] = found = true;
        return found;
    }
    for (const [index, token] of tokens.entries()) {
        if (token.start < end && token.end > start) flags[index] = found = true;
    }
    if (!found && tokens.length) {
        const next = tokens.findIndex((token) => token.start >= start);
        const index = next >= 0 ? next : tokens.length - 1;
        flags[index] = true;
        return true;
    }
    return found;
}

function scoreDocument(document, report) {
    const tokens = sourceTokens(document.text),
        gold = tokens.map(() => false),
        predicted = tokens.map(() => false),
        goldByType = new Map(),
        integrityErrors = [];
    if (report.text !== document.text) integrityErrors.push("analysis-source-changed");
    for (const annotation of document.annotations) {
        let typeFlags = goldByType.get(annotation.type);
        if (!typeFlags) {
            typeFlags = { flags: tokens.map(() => false), annotations: 0 };
            goldByType.set(annotation.type, typeFlags);
        }
        typeFlags.annotations++;
        for (const [start, end] of annotation.spans) {
            if (start < 0 || end < start || end > document.text.length) {
                integrityErrors.push(`gold-offset:${annotation.type}`);
                continue;
            }
            markSpan(tokens, gold, start, end);
            markSpan(tokens, typeFlags.flags, start, end);
        }
    }
    for (const diagnostic of report.diagnostics ?? []) {
        if (
            diagnostic.start < 0 ||
            diagnostic.end < diagnostic.start ||
            diagnostic.end > document.text.length
        ) {
            integrityErrors.push(`diagnostic-range:${diagnostic.ruleId}`);
            continue;
        }
        for (const proposal of diagnostic.proposals ?? [])
            for (const edit of proposal.edits ?? [])
                if (
                    edit.start < 0 ||
                    edit.end < edit.start ||
                    edit.end > document.text.length ||
                    document.text.slice(edit.start, edit.end) !== edit.expected
                )
                    integrityErrors.push(`edit-source:${diagnostic.ruleId}`);
        for (const evidence of diagnostic.evidence ?? [])
            if (
                evidence.start < 0 ||
                evidence.end < evidence.start ||
                evidence.end > document.text.length
            )
                integrityErrors.push(`evidence-range:${diagnostic.ruleId}`);
        markSpan(tokens, predicted, diagnostic.start, diagnostic.end);
    }
    const counts = { TP: 0, FP: 0, FN: 0, TN: 0 };
    tokens.forEach((_, index) => {
        counts[gold[index] ? (predicted[index] ? "TP" : "FN") : predicted[index] ? "FP" : "TN"]++;
    });
    const annotationLabelRecall = Object.fromEntries(
        [...goldByType].map(([type, value]) => {
            const goldTokens = value.flags.filter(Boolean).length,
                detectedGoldTokens = value.flags.reduce(
                    (total, marked, index) => total + (marked && predicted[index] ? 1 : 0),
                    0,
                );
            return [type, { annotations: value.annotations, goldTokens, detectedGoldTokens }];
        }),
    );
    return {
        counts,
        tokenCount: tokens.length,
        goldErrorTokens: gold.filter(Boolean).length,
        annotationLabelRecall,
        integrityErrors,
    };
}

function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function documentBootstrap(documents, iterations = 1000) {
    const metrics = { precision: [], recall: [], f0_5: [], falsePositiveRate: [] };
    for (let replicate = 0; replicate < iterations; replicate++) {
        const totals = { TP: 0, FP: 0, FN: 0, TN: 0 };
        for (let sample = 0; sample < documents.length; sample++) {
            const digest = hash(`linguorithm-realec-bootstrap-v1:${replicate}:${sample}`),
                index = Number.parseInt(digest.slice(0, 8), 16) % documents.length,
                counts = documents[index].counts;
            for (const key of Object.keys(totals)) totals[key] += counts[key];
        }
        const result = ratios(totals);
        for (const key of Object.keys(metrics))
            if (result[key] !== null) metrics[key].push(result[key]);
    }
    return Object.fromEntries(
        Object.entries(metrics).map(([key, values]) => {
            values.sort((a, b) => a - b);
            return [key, { lower: percentile(values, 0.025), upper: percentile(values, 0.975) }];
        }),
    );
}

function modelArtifacts() {
    const root = "apps/web/dist",
        registryPath = `${root}/models/registry.json`;
    if (!existsSync(registryPath))
        throw new Error("Build the production app before evaluating REALEC.");
    const registryBytes = readFileSync(registryPath),
        registry = JSON.parse(registryBytes.toString("utf8")),
        resources = {};
    for (const [name, resource] of Object.entries(registry)) {
        if (!resource || typeof resource.path !== "string") continue;
        const asset = readFileSync(`${root}/models/${resource.path}`),
            actual = hash(asset);
        if (actual !== resource.sha256) throw new Error(`Production model hash mismatch: ${name}`);
        resources[name] = actual;
        if (["tagger", "parser", "classifier"].includes(name)) {
            const artifact = JSON.parse(asset.toString("utf8")),
                weights = readFileSync(`${root}/models/weights/${artifact.artifact}`),
                weightsHash = hash(weights);
            if (weightsHash !== artifact.sha256)
                throw new Error(`Production weight hash mismatch: ${name}`);
            resources[`${name}Weights`] = weightsHash;
        }
    }
    const worker = readdirSync(`${root}/assets`).find((name) =>
        /^analysis\.worker-.*\.js$/u.test(name),
    );
    if (!worker) throw new Error("Production analysis worker is missing.");
    return {
        registryVersion: registry.version,
        registrySha256: hash(registryBytes),
        resources,
        worker,
        workerSha256: hash(readFileSync(`${root}/assets/${worker}`)),
    };
}

const manifest = json(manifestPath),
    dataBytes = readFileSync(inputPath),
    dataset = JSON.parse(dataBytes.toString("utf8"));
if (dataset.format !== "linguorithm-realec-local-benchmark-v1")
    throw new Error("Unexpected REALEC benchmark format.");
if (dataset.archiveSha256 !== manifest.archiveSha256 || dataset.license !== "CC-BY-SA-4.0")
    throw new Error("REALEC benchmark provenance does not match its pinned manifest.");
const documents = dataset.documents.filter((document) => document.split === "test");
if (documents.length < 50 || documents.some((document) => !document.text || !document.id))
    throw new Error("The fixed REALEC test split is incomplete.");

const items = documents.map((document) => ({ id: document.id, text: document.text })),
    baseUrl = process.env.REALEC_BASE_URL ?? "http://127.0.0.1:4318";
let previewServer;
try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error("Production preview is unavailable.");
} catch (error) {
    if (process.env.REALEC_BASE_URL) throw error;
    previewServer = await preview({
        configFile: resolve("apps/web/vite.config.ts"),
        root: resolve("apps/web"),
        preview: { host: "127.0.0.1", port: 4318, strictPort: true },
    });
}

const browser = await chromium.launch();
let reports;
try {
    const page = await browser.newPage();
    await page.goto(baseUrl);
    const worker = modelArtifacts().worker;
    reports = await page.evaluate(
        async ({ worker, items }) => {
            const instance = new Worker(new URL(`assets/${worker}`, document.baseURI), {
                type: "module",
            });
            let id = 0;
            const analyze = (text) =>
                new Promise((resolve, reject) => {
                    const requestId = ++id,
                        timer = setTimeout(
                            () =>
                                reject(
                                    new Error(`Production worker timed out on case ${requestId}`),
                                ),
                            60_000,
                        );
                    instance.onmessage = (event) => {
                        if (event.data.id !== requestId) return;
                        clearTimeout(timer);
                        if (event.data.error) reject(new Error(event.data.error));
                        else resolve(event.data.report);
                    };
                    instance.onerror = (event) => {
                        clearTimeout(timer);
                        reject(new Error(event.message));
                    };
                    instance.postMessage({
                        id: requestId,
                        text,
                        revision: 0,
                        style: false,
                        models: true,
                        assetBase: new URL(".", document.baseURI).href,
                    });
                });
            try {
                const results = [];
                for (const item of items) results.push(await analyze(item.text));
                return results;
            } finally {
                instance.terminate();
            }
        },
        { worker, items },
    );
} finally {
    await browser.close();
    await new Promise((accept, reject) => {
        if (!previewServer) return accept();
        previewServer.httpServer.close((error) => (error ? reject(error) : accept()));
    });
}

if (
    reports.length !== documents.length ||
    reports.some((report) => report.modelStatus?.state !== "ready")
)
    throw new Error("Every REALEC case must be analyzed by the ready production model.");
const scoredDocuments = documents.map((document, index) => ({
        id: document.id,
        ...scoreDocument(document, reports[index]),
    })),
    total = scoredDocuments.reduce(
        (result, document) => {
            for (const key of Object.keys(result.counts))
                result.counts[key] += document.counts[key];
            result.tokens += document.tokenCount;
            result.goldErrorTokens += document.goldErrorTokens;
            result.integrityErrors.push(...document.integrityErrors);
            return result;
        },
        {
            counts: { TP: 0, FP: 0, FN: 0, TN: 0 },
            tokens: 0,
            goldErrorTokens: 0,
            integrityErrors: [],
        },
    );
if (total.integrityErrors.length) {
    const failures = scoredDocuments
        .filter((document) => document.integrityErrors.length)
        .map(({ id, integrityErrors }) => ({ id, integrityErrors }));
    throw new Error(
        `Source span integrity failures: ${JSON.stringify({ count: total.integrityErrors.length, failures })}`,
    );
}
const annotationTypes = new Map();
for (const document of documents)
    for (const annotation of document.annotations)
        annotationTypes.set(annotation.type, (annotationTypes.get(annotation.type) ?? 0) + 1);
const annotationLabelRecall = {};
for (const document of scoredDocuments)
    for (const [type, counts] of Object.entries(document.annotationLabelRecall)) {
        const total = (annotationLabelRecall[type] ??= {
            annotations: 0,
            goldTokens: 0,
            detectedGoldTokens: 0,
        });
        total.annotations += counts.annotations;
        total.goldTokens += counts.goldTokens;
        total.detectedGoldTokens += counts.detectedGoldTokens;
    }
for (const counts of Object.values(annotationLabelRecall)) {
    counts.recall = counts.goldTokens ? counts.detectedGoldTokens / counts.goldTokens : null;
    counts.recallWilson95 = wilson(counts.detectedGoldTokens, counts.goldTokens);
}
const result = {
    generatedAt: new Date().toISOString(),
    dataset: {
        name: manifest.name,
        license: manifest.license,
        archiveSha256: manifest.archiveSha256,
        preparedDataSha256: hash(dataBytes),
        attribution: manifest.attribution,
        sourcePage: manifest.sourcePage,
        testDocuments: documents.length,
        totalAvailableDocuments: dataset.documents.length,
        splitPolicy: dataset.splitPolicy,
        authorIdentityAvailable: false,
        annotationTypes: Object.fromEntries(
            [...annotationTypes].sort(([a], [b]) => a.localeCompare(b)),
        ),
    },
    system: {
        description:
            "Frozen production browser worker with local syntax and grammar models; optional style cues disabled; no network inference.",
        analyzedDocuments: reports.length,
        modelReady: true,
        artifacts: modelArtifacts(),
    },
    evaluation: {
        scope: "Document-held-out binary error-span detection on an independently sourced Russian-L1 university learner-essay corpus. This is an overall task metric, not per-pattern validation. Author-level independence is unavailable; the corpus population is narrow and does not represent preschool through advanced secondary writers.",
        tokenization:
            "Source tokens are Unicode words with internal apostrophes plus individual non-whitespace punctuation. Gold error spans and production finding offsets are projected by overlap; zero-width insertion findings map to the following token, or the preceding final token.",
        counts: total.counts,
        tokens: total.tokens,
        goldErrorTokens: total.goldErrorTokens,
        detectedErrorTokens: total.counts.TP + total.counts.FP,
        ...ratios(total.counts),
        annotationLabelRecall: Object.fromEntries(
            Object.entries(annotationLabelRecall).sort(([a], [b]) => a.localeCompare(b)),
        ),
        documentClusterBootstrap95: documentBootstrap(scoredDocuments),
        bootstrap: {
            method: "1,000 deterministic document-cluster bootstrap replicates",
            seed: "linguorithm-realec-bootstrap-v1",
            caveat: "Documents may share authors; writer-cluster intervals cannot be computed.",
        },
        sourceSpanIntegrity: true,
        patternQualityGates:
            "Not evaluated: the released evaluation labels errors as binary spans and does not provide pattern-specific valid controls or correction judgments.",
        correctionAcceptability:
            "Not evaluated: annotation surfaces are not adjudicated acceptable corrections and findings are scored as binary detection only.",
    },
};
const formatted = await format(
    reportPath,
    JSON.stringify(result, null, 4) + "\n",
    json("oxfmt.json"),
);
if (formatted.errors.length)
    throw new Error(
        `Could not format ${reportPath}: ${formatted.errors.map((error) => error.message).join("; ")}`,
    );
writeFileSync(reportPath, formatted.code);
console.log(
    JSON.stringify(
        {
            path: reportPath,
            documents: documents.length,
            tokens: total.tokens,
            counts: total.counts,
            precision: result.evaluation.precision,
            recall: result.evaluation.recall,
            f0_5: result.evaluation.f0_5,
            falsePositiveRate: result.evaluation.falsePositiveRate,
        },
        null,
        2,
    ),
);
