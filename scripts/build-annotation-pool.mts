import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPipeline } from "../packages/engine/src/pipeline";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkPath = resolve(root, ".cache/datasets/realec/benchmark.json");
const outputPath = resolve(root, ".cache/datasets/realec/v2/pool.json");
const POOL_FORMAT = "linguorithm-annotation-pool-v1";
const PROBE_COUNT = 200;
const PROBE_SEED = 20261117;
const CONTROL_SEED = 20261118;
const MAX_ITEMS = 6000;

interface CorpusAnnotation {
    type?: string;
    spans?: unknown;
}
interface CorpusDocument {
    id: string;
    split: string;
    text: string;
    annotations?: CorpusAnnotation[];
}
interface Benchmark {
    documents: CorpusDocument[];
}
interface Span {
    start: number;
    end: number;
}
interface Proposal {
    label: string;
    replacement: string;
}
interface PoolCounts {
    total: number;
    finding: number;
    control: number;
    probe: number;
}
interface PoolItem {
    id: string;
    documentId: string;
    kind: "finding" | "control" | "probe";
    sentence: string;
    span: Span;
    category?: string;
    ruleId?: string;
    certainty?: string;
    confidence?: number | null;
    proposals?: Proposal[];
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
    const output = [...values];
    const random = mulberry32(seed);
    for (let i = output.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const value = output[i]!;
        output[i] = output[j]!;
        output[j] = value;
    }
    return output;
}

function uniqueId(base: string, seen: Set<string>): string {
    if (!seen.has(base)) {
        seen.add(base);
        return base;
    }
    let suffix = 2;
    while (seen.has(`${base}#${suffix}`)) suffix++;
    const id = `${base}#${suffix}`;
    seen.add(id);
    return id;
}

function annotationSpans(document: CorpusDocument): Span[] {
    const spans: Span[] = [];
    for (const annotation of document.annotations ?? []) {
        if (!Array.isArray(annotation.spans)) continue;
        for (const span of annotation.spans) {
            if (!Array.isArray(span) || span.length !== 2) continue;
            const [start, end] = span;
            if (Number.isInteger(start) && Number.isInteger(end) && end > start)
                spans.push({ start, end });
        }
    }
    return spans;
}

function overlaps(a: Span, b: Span): boolean {
    return a.start < b.end && b.start < a.end;
}

function applyProposals(
    sentence: { start: number; end: number; text: string },
    proposals: readonly {
        label: string;
        edits: readonly { start: number; end: number; expected: string; replacement: string }[];
    }[],
): Proposal[] {
    const output: Proposal[] = [];
    for (const proposal of proposals) {
        if (!proposal.edits.length) continue;
        let replacement = sentence.text;
        let valid = true;
        for (const edit of [...proposal.edits].sort((a, b) => b.start - a.start)) {
            if (edit.start < sentence.start || edit.end > sentence.end) {
                valid = false;
                break;
            }
            const start = edit.start - sentence.start;
            const end = edit.end - sentence.start;
            if (replacement.slice(start, end) !== edit.expected) {
                valid = false;
                break;
            }
            replacement = replacement.slice(0, start) + edit.replacement + replacement.slice(end);
        }
        if (valid) output.push({ label: proposal.label, replacement });
        if (output.length === 3) break;
    }
    return output;
}

function buildPool(documents: readonly CorpusDocument[]): {
    items: PoolItem[];
    counts: PoolCounts;
} {
    const pipeline = createPipeline();
    const items: PoolItem[] = [];
    const probes: PoolItem[] = [];
    const seen = new Set<string>();

    for (const document of documents) {
        const report = pipeline.analyze(document.text);
        const spans = annotationSpans(document);
        const sentences = report.sentences;

        for (const diagnostic of report.diagnostics) {
            let target: (typeof sentences)[number] | undefined;
            if (diagnostic.end <= diagnostic.start) {
                // Insertion points (missing punctuation) live between sentences; prefer the preceding one.
                target =
                    sentences.find(
                        (sentence) =>
                            diagnostic.start > sentence.start && diagnostic.start < sentence.end,
                    ) ??
                    sentences.find(
                        (sentence) =>
                            diagnostic.start >= sentence.start && diagnostic.start <= sentence.end,
                    );
            } else {
                let bestOverlap = 0;
                for (const sentence of sentences) {
                    const overlap =
                        Math.min(diagnostic.end, sentence.end) -
                        Math.max(diagnostic.start, sentence.start);
                    if (overlap > bestOverlap) {
                        bestOverlap = overlap;
                        target = sentence;
                    }
                }
            }
            if (!target) continue;

            const start = Math.max(
                0,
                Math.min(target.text.length, diagnostic.start - target.start),
            );
            const end = Math.max(
                start,
                Math.min(target.text.length, diagnostic.end - target.start),
            );

            const covered = target.tokens.filter(
                (token) => token.start < diagnostic.end && token.end > diagnostic.start,
            );
            // Insertion findings (missing punctuation) have no covered token; anchor controls on the next token.
            const anchor =
                covered[0] ??
                target.tokens.find((token) => token.end > diagnostic.start) ??
                target.tokens.at(-1);
            const anchorIndex = anchor ? target.tokens.indexOf(anchor) : -1;
            const preceding = anchorIndex > 0 ? target.tokens[anchorIndex - 1] : undefined;

            const finding: PoolItem = {
                id: uniqueId(
                    `finding:${document.id}:${diagnostic.ruleId}:${diagnostic.start}:${diagnostic.end}`,
                    seen,
                ),
                documentId: document.id,
                kind: "finding",
                sentence: target.text,
                span: { start, end },
                category: diagnostic.category,
                ruleId: diagnostic.ruleId,
                certainty: diagnostic.certainty,
                confidence: diagnostic.confidence.probability ?? null,
                proposals: applyProposals(target, diagnostic.proposals),
            };
            items.push(finding);

            const tokenCount = covered.length || 1;
            if (!anchor) continue;

            const candidates: {
                span: Span;
                sentence: string;
                precedingMatches: boolean;
                distance: number;
            }[] = [];
            for (const sentence of sentences) {
                const tokens = sentence.tokens;
                for (let index = 0; index + tokenCount <= tokens.length; index++) {
                    const window = tokens.slice(index, index + tokenCount);
                    const windowSpan = {
                        start: window[0]!.start,
                        end: window.at(-1)!.end,
                    };
                    if (windowSpan.end <= windowSpan.start) continue;
                    if (windowSpan.start >= diagnostic.start && windowSpan.end <= diagnostic.end)
                        continue;
                    if (overlaps(windowSpan, diagnostic)) continue;
                    if (spans.some((span) => overlaps(windowSpan, span))) continue;
                    const before = tokens[index - 1];
                    candidates.push({
                        span: windowSpan,
                        sentence: sentence.text,
                        precedingMatches:
                            Boolean(preceding) &&
                            Boolean(before) &&
                            before!.text.toLowerCase() === preceding!.text.toLowerCase(),
                        distance: Math.abs(windowSpan.start - diagnostic.start),
                    });
                }
            }
            candidates.sort(
                (a, b) =>
                    Number(b.precedingMatches) - Number(a.precedingMatches) ||
                    a.distance - b.distance ||
                    a.span.start - b.span.start,
            );

            const chosen: Span[] = [];
            for (const candidate of candidates) {
                if (chosen.length === 2) break;
                if (chosen.some((span) => overlaps(span, candidate.span))) continue;
                chosen.push(candidate.span);
                const relative = {
                    start: candidate.span.start,
                    end: candidate.span.end,
                };
                // Find the containing sentence for a sentence-relative span.
                for (const sentence of sentences) {
                    if (relative.start >= sentence.start && relative.end <= sentence.end) {
                        items.push({
                            id: uniqueId(
                                `control:${document.id}:${diagnostic.ruleId}:${diagnostic.start}:${chosen.length}`,
                                seen,
                            ),
                            documentId: document.id,
                            kind: "control",
                            sentence: sentence.text,
                            span: {
                                start: relative.start - sentence.start,
                                end: relative.end - sentence.start,
                            },
                        });
                        break;
                    }
                }
            }
        }

        for (const [index, sentence] of sentences.entries()) {
            probes.push({
                id: uniqueId(`probe:${document.id}:${index}`, seen),
                documentId: document.id,
                kind: "probe",
                sentence: sentence.text,
                span: { start: 0, end: sentence.text.length },
            });
        }
    }

    const sampledProbes = shuffled(probes, PROBE_SEED)
        .slice(0, PROBE_COUNT)
        .sort((a, b) => a.id.localeCompare(b.id));

    const findings = items.filter((item) => item.kind === "finding");
    let controls = items.filter((item) => item.kind === "control");
    let selectedProbes = sampledProbes;

    const total = findings.length + controls.length + selectedProbes.length;
    if (total > MAX_ITEMS) {
        const budget = Math.max(0, MAX_ITEMS - findings.length);
        const controlShare = controls.length + selectedProbes.length;
        const keepControls =
            controlShare === 0 ? 0 : Math.floor((budget * controls.length) / controlShare);
        const keepProbes = Math.min(budget - keepControls, selectedProbes.length);
        controls = shuffled(controls, CONTROL_SEED)
            .slice(0, keepControls)
            .sort((a, b) => a.id.localeCompare(b.id));
        selectedProbes = shuffled(selectedProbes, PROBE_SEED + 1)
            .slice(0, keepProbes)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    const finalItems = [...findings, ...controls, ...selectedProbes];
    const counts: PoolCounts = {
        total: finalItems.length,
        finding: findings.length,
        control: controls.length,
        probe: selectedProbes.length,
    };
    return { items: finalItems, counts };
}

function selfTest(
    documents: readonly CorpusDocument[],
    first: { items: PoolItem[]; counts: PoolCounts },
): void {
    const failures: string[] = [];
    const ids = new Set<string>();
    for (const item of first.items) {
        if (ids.has(item.id)) failures.push(`duplicate id: ${item.id}`);
        ids.add(item.id);
        for (const field of ["label", "gold", "annotations"])
            if (field in item) failures.push(`forbidden field ${field} on ${item.id}`);
        if (
            !Number.isInteger(item.span.start) ||
            !Number.isInteger(item.span.end) ||
            item.span.start < 0 ||
            item.span.end < item.span.start ||
            item.span.end > item.sentence.length
        )
            failures.push(`span outside sentence: ${item.id}`);
    }
    const { counts } = first;
    if (counts.finding + counts.control + counts.probe !== counts.total)
        failures.push("counts do not sum to total");
    if (counts.total !== first.items.length) failures.push("counts total does not match items");
    for (const kind of ["finding", "control", "probe"] as const) {
        const actual = first.items.filter((item) => item.kind === kind).length;
        if (counts[kind] !== actual) failures.push(`count for ${kind} does not match items`);
    }
    const second = buildPool(documents);
    if (JSON.stringify(second.items) !== JSON.stringify(first.items))
        failures.push("pool items are not deterministic");
    if (failures.length) {
        console.error(failures.join("\n"));
        process.exitCode = 1;
        return;
    }
    console.log(`self-test passed: ${counts.total} items, ${ids.size} unique ids, deterministic`);
}

function summarize(
    items: readonly PoolItem[],
    documents: readonly CorpusDocument[],
): Record<string, unknown> {
    const byKind: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const docsByKind: Record<string, Set<string>> = {
        finding: new Set(),
        control: new Set(),
        probe: new Set(),
    };
    for (const item of items) {
        byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
        docsByKind[item.kind]!.add(item.documentId);
        if (item.kind === "finding")
            byCategory[item.category ?? "unknown"] =
                (byCategory[item.category ?? "unknown"] ?? 0) + 1;
    }
    return {
        byKind,
        byCategory,
        documentCoverage: Object.fromEntries(
            Object.entries(docsByKind).map(([kind, docs]) => [kind, docs.size]),
        ),
        developmentDocuments: documents.length,
        documentsWithFindings: docsByKind.finding!.size,
    };
}

const benchmark = JSON.parse(readFileSync(benchmarkPath, "utf8")) as Benchmark;
const documents = benchmark.documents.filter((document) => document.split === "development");
const built = buildPool(documents);
const pool = {
    format: POOL_FORMAT,
    generatedAt: new Date().toISOString(),
    counts: built.counts,
    items: built.items,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(pool, null, 2)}\n`);

console.log(JSON.stringify(summarize(built.items, documents), null, 2));

if (process.argv.includes("--self-test")) selfTest(documents, built);
