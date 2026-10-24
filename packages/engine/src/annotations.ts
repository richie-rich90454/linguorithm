import { z } from "zod";

const identity = z.string().trim().min(1).max(250);
const probability = z.number().finite().min(0).max(1);
export const annotationCategorySchema = z.enum([
    "Grammar",
    "Punctuation",
    "Spelling",
    "Usage",
    "Style",
]);
const spanSchema = z.strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
});
const provenanceSchema = z.strictObject({
    id: identity,
    version: identity,
    at: z.iso.datetime(),
    method: z.enum(["manual", "import"]),
    source: identity,
});

/** Offsets are half-open UTF-16 code units, including zero-width insertion sites. */
export const annotatedErrorSchema = z
    .strictObject({
        id: identity,
        documentId: identity,
        sentenceId: identity,
        ...spanSchema.shape,
        category: annotationCategorySchema,
        subtype: identity,
        original: z.string(),
        corrected: z.string(),
        acceptedAlternatives: z.array(z.string()).max(100),
        relationship: z.strictObject({
            type: identity,
            evidence: z
                .array(z.strictObject({ ...spanSchema.shape, text: z.string(), role: identity }))
                .min(1)
                .max(100),
        }),
        confidence: probability,
        severity: z.enum(["minor", "moderate", "major"]),
        isStyle: z.boolean(),
        annotators: z.array(provenanceSchema).min(1).max(100),
        adjudication: z.strictObject({
            status: z.enum(["unreviewed", "agreed", "adjudicated", "rejected"]),
            by: identity.optional(),
            at: z.iso.datetime().optional(),
            rationale: z.string().trim().min(1).max(10_000).optional(),
        }),
    })
    .superRefine((error, ctx) => {
        const issue = (message: string) => ctx.addIssue({ code: "custom", message });
        if (error.end < error.start) issue("Annotation end precedes start.");
        if (error.isStyle !== (error.category === "Style"))
            issue("Style labels must be explicitly separated from grammatical errors.");
        const corrections = [error.corrected, ...error.acceptedAlternatives];
        if (
            new Set(corrections).size !== corrections.length ||
            corrections.includes(error.original)
        )
            issue("Corrections must be distinct and change the original text.");
        if (new Set(error.annotators.map((a) => a.id)).size !== error.annotators.length)
            issue("Annotator identities must be unique.");
        if (error.adjudication.status === "agreed" && error.annotators.length < 2)
            issue("Agreement requires at least two annotators.");
        if (
            ["adjudicated", "rejected"].includes(error.adjudication.status) &&
            (!error.adjudication.by || !error.adjudication.at || !error.adjudication.rationale)
        )
            issue("Adjudication requires a reviewer, timestamp, and rationale.");
    });
export type AnnotatedError = z.infer<typeof annotatedErrorSchema>;

export function validUtf16Span(text: string, start: number, end: number): boolean {
    const boundary = (offset: number) => {
        const previous = text.charCodeAt(offset - 1);
        const next = text.charCodeAt(offset);
        return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
    };
    return (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end >= start &&
        end <= text.length &&
        boundary(start) &&
        boundary(end)
    );
}

export const annotatedDocumentSchema = z
    .strictObject({
        id: identity,
        text: z.string().max(150_000),
        variety: z.literal("en-US"),
        split: z.enum(["train", "validation", "test"]),
        groups: z.strictObject({
            authorId: identity.optional(),
            sourceId: identity.optional(),
            promptId: identity.optional(),
        }),
        provenance: z.strictObject({
            source: identity,
            license: identity,
            permittedUse: z.array(identity).min(1),
            consent: z.enum(["documented", "not-required", "not-obtained"]),
        }),
        reviewStatus: z.enum(["unreviewed", "double-annotated", "adjudicated"]),
        validControl: z.boolean(),
        sentences: z
            .array(z.strictObject({ id: identity, ...spanSchema.shape, text: z.string().min(1) }))
            .min(1),
        errors: z.array(annotatedErrorSchema).max(10_000),
    })
    .superRefine((document, ctx) => {
        const issue = (message: string) => ctx.addIssue({ code: "custom", message });
        const sentences = new Map(document.sentences.map((s) => [s.id, s]));
        if (sentences.size !== document.sentences.length) issue("Duplicate sentence identifiers.");
        let previousEnd = 0;
        for (const sentence of document.sentences) {
            if (
                !validUtf16Span(document.text, sentence.start, sentence.end) ||
                sentence.end <= sentence.start ||
                sentence.start < previousEnd ||
                document.text.slice(sentence.start, sentence.end) !== sentence.text
            )
                issue(`Invalid sentence source span: ${sentence.id}`);
            previousEnd = sentence.end;
        }
        if (new Set(document.errors.map((e) => e.id)).size !== document.errors.length)
            issue("Duplicate annotation identifiers.");
        const activeErrors = document.errors.filter((e) => e.adjudication.status !== "rejected");
        if (
            new Set(
                activeErrors.map((e) => JSON.stringify([e.start, e.end, e.category, e.subtype])),
            ).size !== activeErrors.length
        )
            issue("Duplicate active span/category/subtype labels.");
        for (const error of document.errors) {
            const sentence = sentences.get(error.sentenceId);
            if (
                error.documentId !== document.id ||
                !sentence ||
                error.start < sentence.start ||
                error.end > sentence.end ||
                !validUtf16Span(document.text, error.start, error.end) ||
                document.text.slice(error.start, error.end) !== error.original
            )
                issue(`Annotation does not match its original document/sentence: ${error.id}`);
            for (const evidence of error.relationship.evidence)
                if (
                    !validUtf16Span(document.text, evidence.start, evidence.end) ||
                    document.text.slice(evidence.start, evidence.end) !== evidence.text
                )
                    issue(`Invalid relationship evidence: ${error.id}`);
            if (document.validControl && !error.isStyle && error.adjudication.status !== "rejected")
                issue("A valid grammatical control cannot contain accepted grammatical errors.");
        }
    });
export type AnnotatedDocument = z.infer<typeof annotatedDocumentSchema>;
export const annotatedCorpusSchema = z
    .strictObject({
        format: z.literal("grammar-annotations"),
        version: identity,
        id: identity,
        description: z.string().min(1).max(10_000),
        documents: z.array(annotatedDocumentSchema).min(1).max(100_000),
    })
    .superRefine((corpus, ctx) => {
        if (new Set(corpus.documents.map((d) => d.id)).size !== corpus.documents.length)
            ctx.addIssue({ code: "custom", message: "Duplicate document identifiers." });
    });
export type AnnotatedCorpus = z.infer<typeof annotatedCorpusSchema>;

const groupFields = ["authorId", "sourceId", "promptId"] as const;
export function inspectSplitLeakage(documents: readonly AnnotatedDocument[]) {
    const groups = new Map<string, AnnotatedDocument[]>();
    const missing = { authorId: 0, sourceId: 0, promptId: 0 };
    for (const document of documents) {
        const add = (field: string, value: string) => {
            const key = JSON.stringify([field, value]);
            groups.set(key, [...(groups.get(key) ?? []), document]);
        };
        for (const field of groupFields) {
            const value = document.groups[field];
            if (value) add(field, value);
            else missing[field]++;
        }
        add("normalizedText", document.text.normalize("NFC").replace(/\s+/gu, " ").trim());
    }
    const leaks = [...groups].flatMap(([key, members]) => {
        const splits = [...new Set(members.map((d) => d.split))];
        const [field, value] = JSON.parse(key) as [string, string];
        return splits.length > 1
            ? [{ field, value, splits, documentIds: members.map((d) => d.id) }]
            : [];
    });
    return { passed: leaks.length === 0, leaks, missingGroupMetadata: missing };
}

export interface AnnotationSubmission {
    annotatorId: string;
    documents: { documentId: string; errors: AnnotatedError[] }[];
}
export const annotationSubmissionsSchema = z
    .array(
        z.strictObject({
            annotatorId: identity,
            documents: z
                .array(
                    z.strictObject({ documentId: identity, errors: z.array(annotatedErrorSchema) }),
                )
                .min(1),
        }),
    )
    .min(2);

const errorKey = (error: Pick<AnnotatedError, "start" | "end" | "category" | "subtype">) =>
    JSON.stringify([error.start, error.end, error.category, error.subtype]);
const accepted = (error: AnnotatedError) => [error.corrected, ...error.acceptedAlternatives];

/** Pairwise kappa uses the union of annotated spans, not invented negative token labels. */
export function annotationAgreement(corpus: AnnotatedCorpus, input: unknown) {
    const submissions = annotationSubmissionsSchema.parse(input);
    if (new Set(submissions.map((s) => s.annotatorId)).size !== submissions.length)
        throw new Error("Each annotator must submit exactly one batch.");
    const documents = new Map(corpus.documents.map((d) => [d.id, d]));
    for (const submission of submissions) {
        if (
            new Set(submission.documents.map((d) => d.documentId)).size !==
            submission.documents.length
        )
            throw new Error("Duplicate document in annotator submission.");
        for (const item of submission.documents) {
            const document = documents.get(item.documentId);
            if (!document) throw new Error(`Unknown document: ${item.documentId}`);
            annotatedDocumentSchema.parse({
                ...document,
                validControl: false,
                errors: item.errors,
            });
            if (item.errors.some((e) => !e.annotators.some((a) => a.id === submission.annotatorId)))
                throw new Error("Submission annotation is missing its annotator provenance.");
        }
    }
    const pairs = [];
    for (let a = 0; a < submissions.length; a++) {
        for (let b = a + 1; b < submissions.length; b++) {
            const left = submissions[a]!;
            const right = submissions[b]!;
            const rightDocuments = new Map(right.documents.map((d) => [d.documentId, d.errors]));
            let sharedDocuments = 0,
                emptyAgreements = 0,
                leftCount = 0,
                rightCount = 0,
                matches = 0,
                correctionMatches = 0,
                correctionOverlap = 0,
                units = 0,
                observed = 0;
            const leftLabels = new Map<string, number>();
            const rightLabels = new Map<string, number>();
            for (const item of left.documents) {
                const other = rightDocuments.get(item.documentId);
                if (!other) continue;
                sharedDocuments++;
                const first = item.errors.filter((e) => e.adjudication.status !== "rejected");
                const second = other.filter((e) => e.adjudication.status !== "rejected");
                leftCount += first.length;
                rightCount += second.length;
                if (!first.length && !second.length) emptyAgreements++;
                const remaining = new Set(second.map((_, index) => index));
                for (const error of first) {
                    const index = second.findIndex(
                        (e, i) => remaining.has(i) && errorKey(e) === errorKey(error),
                    );
                    if (index < 0) continue;
                    remaining.delete(index);
                    matches++;
                    if (error.corrected === second[index]!.corrected) correctionMatches++;
                    if (accepted(error).some((c) => accepted(second[index]!).includes(c)))
                        correctionOverlap++;
                }
                const spans = new Set([...first, ...second].map((e) => `${e.start}:${e.end}`));
                for (const span of spans) {
                    const label = (errors: AnnotatedError[]) =>
                        JSON.stringify(
                            errors
                                .filter((e) => `${e.start}:${e.end}` === span)
                                .map((e) => [e.category, e.subtype])
                                .sort(),
                        );
                    const x = label(first),
                        y = label(second);
                    units++;
                    if (x === y) observed++;
                    leftLabels.set(x, (leftLabels.get(x) ?? 0) + 1);
                    rightLabels.set(y, (rightLabels.get(y) ?? 0) + 1);
                }
            }
            const expected = units
                ? [...leftLabels].reduce(
                      (sum, [label, count]) => sum + count * (rightLabels.get(label) ?? 0),
                      0,
                  ) /
                  units ** 2
                : null;
            const agreement = units ? observed / units : null;
            pairs.push({
                annotators: [left.annotatorId, right.annotatorId],
                sharedDocuments,
                emptyAgreements,
                leftAnnotations: leftCount,
                rightAnnotations: rightCount,
                exactMatches: matches,
                detectionF1:
                    leftCount + rightCount ? (2 * matches) / (leftCount + rightCount) : null,
                preferredCorrectionAgreement: matches ? correctionMatches / matches : null,
                acceptableCorrectionOverlap: matches ? correctionOverlap / matches : null,
                labelUnits: units,
                observedLabelAgreement: agreement,
                expectedLabelAgreement: expected,
                cohenKappa:
                    agreement !== null && expected !== null && expected < 1
                        ? (agreement - expected) / (1 - expected)
                        : null,
            });
        }
    }
    const statuses = { unreviewed: 0, agreed: 0, adjudicated: 0, rejected: 0 };
    for (const document of corpus.documents)
        for (const error of document.errors) statuses[error.adjudication.status]++;
    return {
        universe:
            "Union of exact annotated spans per shared document; absent labels form the empty set. No token-level true negatives are assumed.",
        pairs,
        adjudication: {
            statuses,
            pendingDocuments: corpus.documents
                .filter(
                    (d) =>
                        d.reviewStatus !== "adjudicated" ||
                        d.errors.some((e) => e.adjudication.status === "unreviewed"),
                )
                .map((d) => d.id),
        },
    };
}

const evaluationEditSchema = z.strictObject({
    ...spanSchema.shape,
    expected: z.string(),
    replacement: z.string(),
});
export const systemRunSchema = z
    .strictObject({
        format: z.literal("grammar-predictions"),
        id: identity,
        version: identity,
        corpusId: identity,
        corpusVersion: identity,
        kind: z.enum(["full", "baseline", "ablation", "competitor"]),
        settings: z.record(z.string(), z.unknown()),
        omittedComponents: z.array(identity),
        documents: z
            .array(
                z.strictObject({
                    documentId: identity,
                    text: z.string().max(150_000),
                    predictions: z
                        .array(
                            z.strictObject({
                                id: identity,
                                ...spanSchema.shape,
                                original: z.string(),
                                category: annotationCategorySchema,
                                subtype: identity,
                                confidence: probability.nullable(),
                                candidates: z
                                    .array(
                                        z.strictObject({
                                            confidence: probability.nullable().optional(),
                                            edits: z.array(evaluationEditSchema).min(1).max(100),
                                        }),
                                    )
                                    .max(100),
                            }),
                        )
                        .max(10_000),
                    latencyMs: z.number().finite().nonnegative().optional(),
                    peakMemoryBytes: z.number().finite().nonnegative().optional(),
                }),
            )
            .min(1),
    })
    .superRefine((run, ctx) => {
        if (new Set(run.documents.map((d) => d.documentId)).size !== run.documents.length)
            ctx.addIssue({ code: "custom", message: "Duplicate run document identifiers." });
        if (run.kind === "ablation" && !run.omittedComponents.length)
            ctx.addIssue({
                code: "custom",
                message: "An ablation must name its omitted components.",
            });
        for (const document of run.documents)
            if (new Set(document.predictions.map((p) => p.id)).size !== document.predictions.length)
                ctx.addIssue({ code: "custom", message: "Duplicate prediction identifiers." });
    });
export type SystemRun = z.infer<typeof systemRunSchema>;
type EvaluationEdit = z.infer<typeof evaluationEditSchema>;

export function checkCorrectionIntegrity(text: string, edits: readonly EvaluationEdit[]) {
    const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
    let previousEnd = -1,
        previousStart = -1,
        delta = 0;
    const inverse: EvaluationEdit[] = [];
    for (const edit of ordered) {
        if (
            !validUtf16Span(text, edit.start, edit.end) ||
            text.slice(edit.start, edit.end) !== edit.expected ||
            edit.start < previousEnd ||
            edit.start === previousStart
        )
            return { valid: false, undoExact: false, result: null };
        inverse.push({
            start: edit.start + delta,
            end: edit.start + delta + edit.replacement.length,
            expected: edit.replacement,
            replacement: edit.expected,
        });
        delta += edit.replacement.length - (edit.end - edit.start);
        previousStart = edit.start;
        previousEnd = edit.end;
    }
    let result = text;
    for (const edit of [...ordered].reverse())
        result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    let restored = result;
    for (const edit of inverse.reverse())
        restored = restored.slice(0, edit.start) + edit.replacement + restored.slice(edit.end);
    return { valid: edits.length > 0 && restored === text, undoExact: restored === text, result };
}

export function wilsonInterval(successes: number, total: number) {
    if (
        !Number.isInteger(total) ||
        !Number.isInteger(successes) ||
        successes < 0 ||
        successes > total
    )
        throw new Error("Invalid binomial counts.");
    if (!total) return null;
    const z = 1.959963984540054,
        p = successes / total,
        denominator = 1 + (z * z) / total;
    const center = (p + (z * z) / (2 * total)) / denominator;
    const half =
        (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
    return {
        lower: Math.max(0, center - half),
        upper: Math.min(1, center + half),
        method: "Wilson 95%",
    };
}

interface Counts {
    tp: number;
    fp: number;
    fn: number;
    spanMatches: number;
    predictions: number;
    unknownConfidencePredictions: number;
    validSpans: number;
    correctionAttempts: number;
    correctionConfidenceKnown: number;
    correctFirst: number;
    correctTopK: number;
    validCandidates: number;
    candidates: number;
    highTp: number;
    highFp: number;
    highCorrectionAttempts: number;
    highCorrectFirst: number;
}
const emptyCounts = (): Counts => ({
    tp: 0,
    fp: 0,
    fn: 0,
    spanMatches: 0,
    predictions: 0,
    unknownConfidencePredictions: 0,
    validSpans: 0,
    correctionAttempts: 0,
    correctionConfidenceKnown: 0,
    correctFirst: 0,
    correctTopK: 0,
    validCandidates: 0,
    candidates: 0,
    highTp: 0,
    highFp: 0,
    highCorrectionAttempts: 0,
    highCorrectFirst: 0,
});
function sumCounts(values: readonly Counts[]): Counts {
    const result = emptyCounts();
    for (const value of values)
        for (const key of Object.keys(result) as (keyof Counts)[]) result[key] += value[key];
    return result;
}
function ratios(c: Counts) {
    const divide = (n: number, d: number) => (d ? n / d : null);
    const precision = divide(c.tp, c.tp + c.fp),
        recall = divide(c.tp, c.tp + c.fn);
    return {
        precision,
        recall,
        f05: c.tp + c.fp + c.fn ? (1.25 * c.tp) / (1.25 * c.tp + 0.25 * c.fn + c.fp) : null,
        top1CorrectionAccuracy: divide(c.correctFirst, c.tp),
        topKAcceptableAmongGold: divide(c.correctTopK, c.tp + c.fn),
        topKAcceptableAmongMatched: divide(c.correctTopK, c.tp),
        directCorrectionPrecision: divide(c.correctFirst, c.correctionAttempts),
        sourceSpanAccuracy: divide(c.spanMatches, c.predictions),
        sourceSpanIntegrity: divide(c.validSpans, c.predictions),
        correctionIntegrity: divide(c.validCandidates, c.candidates),
        highConfidencePrecision: divide(c.highTp, c.highTp + c.highFp),
        highConfidenceCorrectionPrecision: divide(c.highCorrectFirst, c.highCorrectionAttempts),
    };
}
type Ratios = ReturnType<typeof ratios>;

/** Author/source/prompt connected components are resampled together. */
function documentClusters(documents: readonly AnnotatedDocument[]) {
    const parent = documents.map((_, i) => i);
    const root = (i: number): number => {
        let current = i;
        while (parent[current] !== current) current = parent[current]!;
        while (parent[i] !== i) {
            const next = parent[i]!;
            parent[i] = current;
            i = next;
        }
        return current;
    };
    const seen = new Map<string, number>();
    documents.forEach((document, i) => {
        for (const field of groupFields) {
            const value = document.groups[field];
            if (!value) continue;
            const key = JSON.stringify([field, value]),
                previous = seen.get(key);
            if (previous !== undefined) parent[root(i)] = root(previous);
            seen.set(key, i);
        }
    });
    const clusters = new Map<number, number[]>();
    documents.forEach((_, i) => {
        const group = root(i);
        if (!clusters.has(group)) clusters.set(group, []);
        clusters.get(group)!.push(i);
    });
    return [...clusters.values()];
}
function randomGenerator(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
function percentileInterval(values: number[], clusters: number) {
    if (clusters < 2 || values.length < 20) return null;
    values.sort((a, b) => a - b);
    return {
        lower: values[Math.floor((values.length - 1) * 0.025)]!,
        upper: values[Math.ceil((values.length - 1) * 0.975)]!,
        method: "Paired group-cluster percentile bootstrap 95%",
        replicates: values.length,
    };
}

export interface ComparisonOptions {
    split?: AnnotatedDocument["split"];
    topK?: number;
    highConfidence?: number;
    bootstrapSamples?: number;
    seed?: number;
    supportedCategories?: z.infer<typeof annotationCategorySchema>[];
    supportedPatterns?: {
        category: Exclude<z.infer<typeof annotationCategorySchema>, "Style">;
        subtype: string;
        correctionPolicy: "direct" | "review";
    }[];
    minimumCategoryVolume?: number;
    minimumCorrectionVolume?: number;
    minimumControls?: number;
    minimumIndependentGroups?: number;
}

export function parseSupportedPatternDeclarations(
    value: string,
): NonNullable<ComparisonOptions["supportedPatterns"]> {
    return value.split(",").map((entry) => {
        const [rawCategory, rawSubtype, correctionPolicy, ...extra] = entry
            .split("=")
            .map((part) => part.trim());
        if (!rawCategory || !rawSubtype || !correctionPolicy || extra.length)
            throw new Error(
                `Invalid supported pattern '${entry}'. Use Category=subtype=direct or Category=subtype=review.`,
            );
        if (correctionPolicy !== "direct" && correctionPolicy !== "review")
            throw new Error(
                `Invalid correction policy '${correctionPolicy}' in supported pattern '${entry}'.`,
            );
        const category = annotationCategorySchema.parse(rawCategory);
        if (category === "Style")
            throw new Error("Style cannot be declared as a grammatical supported pattern.");
        return { category, subtype: rawSubtype, correctionPolicy };
    });
}

export function requireSupportedPatternDeclarations(
    requireGates: boolean,
    patterns: ComparisonOptions["supportedPatterns"],
): void {
    if (requireGates && !patterns?.length)
        throw new Error(
            "--require-gates requires explicit --supported-patterns declarations with direct or review correction policies.",
        );
}

/** Scores supplied, frozen predictions only. It never invokes a system or creates reference labels. */
export function compareSystems(
    corpusInput: unknown,
    runInputs: readonly unknown[],
    options: ComparisonOptions = {},
) {
    const corpus = annotatedCorpusSchema.parse(corpusInput);
    const runs = runInputs.map((run) => systemRunSchema.parse(run));
    if (!runs.length || new Set(runs.map((r) => r.id)).size !== runs.length)
        throw new Error("Supply at least one run with unique system identifiers.");
    const split = options.split ?? "test",
        topK = options.topK ?? 3;
    const threshold = options.highConfidence ?? 0.95,
        samples = options.bootstrapSamples ?? 1000;
    if (
        !Number.isInteger(topK) ||
        topK < 1 ||
        topK > 100 ||
        !Number.isInteger(samples) ||
        samples < 50 ||
        samples > 10_000 ||
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 1 ||
        (options.seed !== undefined &&
            (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff))
    )
        throw new Error("Invalid top-k, confidence threshold, or bootstrap sample count.");
    const documents = corpus.documents.filter((d) => d.split === split);
    if (!documents.length) throw new Error(`No documents in split: ${split}`);
    if (
        documents.some(
            (d) =>
                d.reviewStatus !== "adjudicated" ||
                d.errors.some((e) => e.adjudication.status === "unreviewed"),
        )
    )
        throw new Error("Evaluation requires adjudicated documents, including empty controls.");
    const leakage = inspectSplitLeakage(corpus.documents);
    if (!leakage.passed)
        throw new Error(`Split leakage detected: ${leakage.leaks.map((l) => l.field).join(", ")}`);
    const clusters = documentClusters(documents);
    const supported = z.array(annotationCategorySchema).parse(options.supportedCategories ?? []);
    if (new Set(supported).size !== supported.length)
        throw new Error("Duplicate supported categories.");
    const supportedPatterns = (options.supportedPatterns ?? []).map((pattern) => {
        const category = annotationCategorySchema.parse(pattern.category);
        if (
            category === "Style" ||
            typeof pattern.subtype !== "string" ||
            !pattern.subtype.trim() ||
            !["direct", "review"].includes(pattern.correctionPolicy)
        )
            throw new Error(
                "Supported patterns require a grammatical category, subtype, and correction policy.",
            );
        return { ...pattern, category };
    });
    const patternKeys = supportedPatterns.map(
        ({ category, subtype }) => `subtype:${JSON.stringify([category, subtype])}`,
    );
    if (new Set(patternKeys).size !== patternKeys.length)
        throw new Error("Duplicate supported patterns.");
    const minimum = {
        category: options.minimumCategoryVolume ?? 200,
        corrections: options.minimumCorrectionVolume ?? 100,
        controls: options.minimumControls ?? 200,
        independentGroups: options.minimumIndependentGroups ?? 30,
    };
    if (Object.values(minimum).some((n) => !Number.isInteger(n) || n < 1))
        throw new Error("Minimum volumes must be positive integers.");
    const series: {
        run: SystemRun;
        counts: Map<string, Counts>[];
        calibration: { probability: number; correct: boolean }[];
        unknownConfidence: number;
        controlFlags: boolean[];
        highControlFlags: boolean[];
        controlFlagsByMetric: Map<string, { all: boolean; high: boolean }>[];
    }[] = [];
    for (const run of runs) {
        if (run.corpusId !== corpus.id || run.corpusVersion !== corpus.version)
            throw new Error(`Corpus version mismatch: ${run.id}`);
        const predictions = new Map(run.documents.map((d) => [d.documentId, d]));
        if (predictions.size !== documents.length || documents.some((d) => !predictions.has(d.id)))
            throw new Error(`Run must cover exactly the selected split: ${run.id}`);
        const counts: Map<string, Counts>[] = [],
            calibration: { probability: number; correct: boolean }[] = [];
        const controlFlags: boolean[] = [],
            highControlFlags: boolean[] = [],
            controlFlagsByMetric: Map<string, { all: boolean; high: boolean }>[] = [];
        let unknownConfidence = 0;
        for (const document of documents) {
            const output = predictions.get(document.id)!;
            if (output.text !== document.text)
                throw new Error(`Stale or changed source text: ${run.id}/${document.id}`);
            const gold = document.errors.filter((e) => e.adjudication.status !== "rejected");
            const matched = new Set<number>(),
                spanMatched = new Set<number>();
            const row = new Map<string, Counts>();
            const controlByMetric = new Map<string, { all: boolean; high: boolean }>();
            const keys = (category: string, subtype: string) => [
                category === "Style" ? "style" : "overall",
                `category:${category}`,
                `subtype:${JSON.stringify([category, subtype])}`,
            ];
            const get = (key: string) => {
                if (!row.has(key)) row.set(key, emptyCounts());
                return row.get(key)!;
            };
            const predictionsOrdered = [...output.predictions].sort(
                (a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || a.id.localeCompare(b.id),
            );
            for (const prediction of predictionsOrdered) {
                const valid =
                    validUtf16Span(document.text, prediction.start, prediction.end) &&
                    document.text.slice(prediction.start, prediction.end) === prediction.original;
                const index = valid
                    ? gold.findIndex(
                          (e, i) => !matched.has(i) && errorKey(e) === errorKey(prediction),
                      )
                    : -1;
                const spanIndex = valid
                    ? gold.findIndex(
                          (e, i) =>
                              !spanMatched.has(i) &&
                              e.start === prediction.start &&
                              e.end === prediction.end &&
                              e.isStyle === (prediction.category === "Style"),
                      )
                    : -1;
                if (index >= 0) matched.add(index);
                if (spanIndex >= 0) spanMatched.add(spanIndex);
                const candidates = prediction.candidates.map((c) =>
                    checkCorrectionIntegrity(document.text, c.edits),
                );
                const reference =
                    index >= 0
                        ? accepted(gold[index]!).map(
                              (c) =>
                                  document.text.slice(0, prediction.start) +
                                  c +
                                  document.text.slice(prediction.end),
                          )
                        : [];
                const correct = candidates.map(
                    (c) => c.valid && c.result !== null && reference.includes(c.result),
                );
                const high = prediction.confidence !== null && prediction.confidence >= threshold;
                const correctionConfidence = prediction.candidates[0]?.confidence;
                const highCorrection =
                    correctionConfidence !== undefined &&
                    correctionConfidence !== null &&
                    correctionConfidence >= threshold;
                for (const key of keys(prediction.category, prediction.subtype)) {
                    const c = get(key);
                    c.predictions++;
                    if (prediction.confidence === null && prediction.category !== "Style")
                        c.unknownConfidencePredictions++;
                    if (valid) c.validSpans++;
                    if (spanIndex >= 0) c.spanMatches++;
                    if (index >= 0) c.tp++;
                    else c.fp++;
                    c.candidates += candidates.length;
                    c.validCandidates += candidates.filter(
                        (candidate) => candidate.valid && candidate.undoExact,
                    ).length;
                    if (candidates.length) c.correctionAttempts++;
                    if (correctionConfidence !== undefined && correctionConfidence !== null)
                        c.correctionConfidenceKnown++;
                    if (correct[0]) c.correctFirst++;
                    if (correct.slice(0, topK).some(Boolean)) c.correctTopK++;
                    if (high) {
                        if (index >= 0) c.highTp++;
                        else c.highFp++;
                    }
                    if (highCorrection) {
                        c.highCorrectionAttempts++;
                        if (correct[0]) c.highCorrectFirst++;
                    }
                    if (document.validControl && prediction.category !== "Style") {
                        const flags = controlByMetric.get(key) ?? { all: false, high: false };
                        flags.all = true;
                        flags.high ||= high;
                        controlByMetric.set(key, flags);
                    }
                }
                if (prediction.category !== "Style") {
                    if (prediction.confidence === null) unknownConfidence++;
                    else
                        calibration.push({
                            probability: prediction.confidence,
                            correct: index >= 0,
                        });
                }
            }
            gold.forEach((e, i) => {
                if (!matched.has(i)) for (const key of keys(e.category, e.subtype)) get(key).fn++;
            });
            counts.push(row);
            controlFlagsByMetric.push(controlByMetric);
            controlFlags.push(
                document.validControl && output.predictions.some((p) => p.category !== "Style"),
            );
            highControlFlags.push(
                document.validControl &&
                    output.predictions.some(
                        (p) =>
                            p.category !== "Style" &&
                            p.confidence !== null &&
                            p.confidence >= threshold,
                    ),
            );
        }
        series.push({
            run,
            counts,
            calibration,
            unknownConfidence,
            controlFlags,
            highControlFlags,
            controlFlagsByMetric,
        });
    }
    const allKeys = [
        ...new Set([
            "overall",
            "style",
            ...supported.map((c) => `category:${c}`),
            ...patternKeys,
            ...series.flatMap((s) => s.counts.flatMap((c) => [...c.keys()])),
        ]),
    ].sort();
    const bootstrapCache = new Map<Map<string, Counts>[], Map<string, Ratios[]>>();
    const boot = (rows: Map<string, Counts>[], key: string) => {
        if (!bootstrapCache.has(rows)) bootstrapCache.set(rows, new Map());
        const cached = bootstrapCache.get(rows)!;
        if (cached.has(key)) return cached.get(key)!;
        const grouped = clusters.map((indices) =>
            sumCounts(indices.map((i) => rows[i]!.get(key) ?? emptyCounts())),
        );
        // Resetting the seeded generator pairs identical cluster draws across systems/metrics.
        // Do not retain a samples × documents array for large held-out corpora.
        const random = randomGenerator(options.seed ?? 20261022);
        const values = Array.from({ length: samples }, () => {
            const result = emptyCounts();
            for (let i = 0; i < clusters.length; i++) {
                const group = grouped[Math.floor(random() * clusters.length)]!;
                for (const field of Object.keys(result) as (keyof Counts)[])
                    result[field] += group[field];
            }
            return ratios(result);
        });
        cached.set(key, values);
        return values;
    };
    const systemReports = series.map((s) => {
        const validControls = documents.filter((d) => d.validControl).length;
        const falseControls = s.controlFlags.filter(Boolean).length,
            highFalseControls = s.highControlFlags.filter(Boolean).length;
        const metrics = allKeys.map((key) => {
            const counts = sumCounts(s.counts.map((row) => row.get(key) ?? emptyCounts())),
                values = ratios(counts),
                bootstrap = boot(s.counts, key);
            const intervals = Object.fromEntries(
                (Object.keys(values) as (keyof Ratios)[]).map((metric) => [
                    metric,
                    percentileInterval(
                        bootstrap.flatMap((b) => (b[metric] === null ? [] : [b[metric]!])),
                        clusters.length,
                    ),
                ]),
            );
            const groupVolume = {
                reference: clusters.filter((indices) =>
                    indices.some((i) => {
                        const c = s.counts[i]!.get(key);
                        return c !== undefined && c.tp + c.fn > 0;
                    }),
                ).length,
                highConfidencePredictions: clusters.filter((indices) =>
                    indices.some((i) => {
                        const c = s.counts[i]!.get(key);
                        return c !== undefined && c.highTp + c.highFp > 0;
                    }),
                ).length,
                predictions: clusters.filter((indices) =>
                    indices.some((i) => {
                        const c = s.counts[i]!.get(key);
                        return c !== undefined && c.predictions > 0;
                    }),
                ).length,
                correctionAttempts: clusters.filter((indices) =>
                    indices.some((i) => {
                        const c = s.counts[i]!.get(key);
                        return c !== undefined && c.correctionAttempts > 0;
                    }),
                ).length,
                controls: clusters.filter((indices) =>
                    indices.some((i) => documents[i]!.validControl),
                ).length,
            };
            const reasons: string[] = [];
            const category = key.startsWith("category:")
                ? annotationCategorySchema.parse(key.slice(9))
                : null;
            const supportedPattern = supportedPatterns.find(
                (pattern) =>
                    key === `subtype:${JSON.stringify([pattern.category, pattern.subtype])}`,
            );
            const declaredCategory =
                category !== null && category !== "Style" && supported.includes(category);
            const declared = declaredCategory || supportedPattern !== undefined;
            const metricControls = documents.flatMap((document, index) =>
                document.validControl
                    ? [s.controlFlagsByMetric[index]!.get(key) ?? { all: false, high: false }]
                    : [],
            );
            const metricFalseControls = metricControls.filter((flags) => flags.all).length;
            const metricHighFalseControls = metricControls.filter((flags) => flags.high).length;
            const metricControlInterval = wilsonInterval(
                metricFalseControls,
                metricControls.length,
            );
            if (declared) {
                const gateGroups = supportedPattern
                    ? [
                          groupVolume.reference,
                          groupVolume.predictions,
                          groupVolume.controls,
                          ...(supportedPattern.correctionPolicy === "direct"
                              ? [groupVolume.correctionAttempts]
                              : []),
                      ]
                    : [
                          groupVolume.reference,
                          groupVolume.highConfidencePredictions,
                          groupVolume.controls,
                      ];
                if (gateGroups.some((n) => n < minimum.independentGroups))
                    reasons.push(
                        "Insufficient independent groups for reference errors, qualifying predictions, corrections, or controls.",
                    );
                if (counts.tp + counts.fn < minimum.category)
                    reasons.push("Insufficient reference errors.");
                if (declaredCategory && counts.unknownConfidencePredictions > 0)
                    reasons.push("Unknown confidence predictions prevent the category gate.");
                if (
                    supportedPattern
                        ? counts.predictions < minimum.category
                        : counts.highTp + counts.highFp < minimum.category
                )
                    reasons.push(
                        supportedPattern
                            ? "Insufficient pattern predictions."
                            : "Insufficient high-confidence predictions.",
                    );
                const correctionAttempts = supportedPattern
                    ? counts.correctionAttempts
                    : counts.highCorrectionAttempts;
                if (
                    (!supportedPattern || supportedPattern.correctionPolicy === "direct") &&
                    correctionAttempts < minimum.corrections
                )
                    reasons.push(
                        supportedPattern
                            ? "Insufficient direct corrections."
                            : "Insufficient high-confidence direct corrections.",
                    );
                const gateControls = supportedPattern ? metricControls.length : validControls;
                if (gateControls < minimum.controls) reasons.push("Insufficient valid controls.");
                const precisionSuccesses = supportedPattern ? counts.tp : counts.highTp;
                const precisionTrials = supportedPattern
                    ? counts.tp + counts.fp
                    : counts.highTp + counts.highFp;
                if ((wilsonInterval(precisionSuccesses, precisionTrials)?.lower ?? 0) < 0.95)
                    reasons.push(
                        supportedPattern
                            ? "Pattern precision Wilson lower bound below 95%."
                            : "High-confidence precision lower bound below 95%.",
                    );
                if ((wilsonInterval(counts.tp, counts.tp + counts.fn)?.lower ?? 0) < 0.9)
                    reasons.push("Recall Wilson lower bound below 90%.");
                const correctionSuccesses = supportedPattern
                    ? counts.correctFirst
                    : counts.highCorrectFirst;
                const correctionTrials = supportedPattern
                    ? counts.correctionAttempts
                    : counts.highCorrectionAttempts;
                if (
                    (!supportedPattern || supportedPattern.correctionPolicy === "direct") &&
                    (wilsonInterval(correctionSuccesses, correctionTrials)?.lower ?? 0) < 0.9
                )
                    reasons.push("Direct-correction precision Wilson lower bound below 90%.");
                const precisionInterval = supportedPattern
                    ? intervals.precision
                    : intervals.highConfidencePrecision;
                const correctionInterval = supportedPattern
                    ? intervals.directCorrectionPrecision
                    : intervals.highConfidenceCorrectionPrecision;
                if (
                    (precisionInterval?.lower ?? 0) < 0.95 ||
                    (intervals.recall?.lower ?? 0) < 0.9 ||
                    ((!supportedPattern || supportedPattern.correctionPolicy === "direct") &&
                        (correctionInterval?.lower ?? 0) < 0.9)
                )
                    reasons.push(
                        "Group-bootstrap confidence bounds do not meet the declared targets.",
                    );
                if ((metricControlInterval?.upper ?? 1) >= 0.02)
                    reasons.push(
                        supportedPattern
                            ? "Pattern valid-control false-positive upper bound is not below 2%."
                            : "Category valid-control false-positive upper bound is not below 2%.",
                    );
                if (
                    counts.validSpans !== counts.predictions ||
                    counts.validCandidates !== counts.candidates
                )
                    reasons.push("Source-span or edit integrity failure.");
                if (
                    supportedPattern?.correctionPolicy === "review" &&
                    counts.correctionAttempts > 0
                )
                    reasons.push("Review-only pattern produced direct corrections.");
            }
            return {
                key,
                counts,
                independentGroups: groupVolume,
                validControlFalsePositives: {
                    documents: metricControls.length,
                    falsePositiveDocuments: metricFalseControls,
                    rate: metricControls.length
                        ? metricFalseControls / metricControls.length
                        : null,
                    interval: metricControlInterval,
                    highConfidenceFalsePositiveDocuments: metricHighFalseControls,
                },
                ...values,
                intervals,
                wilson: {
                    precision: wilsonInterval(counts.tp, counts.tp + counts.fp),
                    recall: wilsonInterval(counts.tp, counts.tp + counts.fn),
                    highConfidencePrecision: wilsonInterval(
                        counts.highTp,
                        counts.highTp + counts.highFp,
                    ),
                    highConfidenceCorrectionPrecision: wilsonInterval(
                        counts.highCorrectFirst,
                        counts.highCorrectionAttempts,
                    ),
                    directCorrectionPrecision: wilsonInterval(
                        counts.correctFirst,
                        counts.correctionAttempts,
                    ),
                },
                releaseGate: {
                    status: declared ? (reasons.length ? "failed" : "passed") : "not-declared",
                    reasons,
                },
            };
        });
        const bins = Array.from({ length: 10 }, (_, i) => {
            const observations = s.calibration.filter(
                (c) => Math.min(9, Math.floor(c.probability * 10)) === i,
            );
            return {
                lower: i / 10,
                upper: (i + 1) / 10,
                count: observations.length,
                meanConfidence: observations.length
                    ? observations.reduce((sum, c) => sum + c.probability, 0) / observations.length
                    : null,
                accuracy: observations.length
                    ? observations.filter((c) => c.correct).length / observations.length
                    : null,
            };
        });
        const latency = s.run.documents
            .flatMap((d) => (d.latencyMs === undefined ? [] : [d.latencyMs]))
            .sort((a, b) => a - b);
        const memory = s.run.documents.flatMap((d) =>
            d.peakMemoryBytes === undefined ? [] : [d.peakMemoryBytes],
        );
        return {
            id: s.run.id,
            version: s.run.version,
            kind: s.run.kind,
            settings: s.run.settings,
            omittedComponents: s.run.omittedComponents,
            metrics,
            validControls: {
                count: validControls,
                falsePositiveDocuments: falseControls,
                rate: validControls ? falseControls / validControls : null,
                interval: wilsonInterval(falseControls, validControls),
                highConfidenceFalsePositiveDocuments: highFalseControls,
                highConfidenceRate: validControls ? highFalseControls / validControls : null,
                highConfidenceInterval: wilsonInterval(highFalseControls, validControls),
            },
            calibration: {
                scope: "Exact-span category-and-subtype diagnostic correctness; grammatical predictions only.",
                knownConfidence: s.calibration.length,
                unknownConfidence: s.unknownConfidence,
                brierScore: s.calibration.length
                    ? s.calibration.reduce(
                          (sum, c) => sum + (c.probability - Number(c.correct)) ** 2,
                          0,
                      ) / s.calibration.length
                    : null,
                expectedCalibrationError: s.calibration.length
                    ? bins.reduce(
                          (sum, b) =>
                              sum + b.count * Math.abs((b.meanConfidence ?? 0) - (b.accuracy ?? 0)),
                          0,
                      ) / s.calibration.length
                    : null,
                bins,
            },
            performance: {
                latencyDocuments: latency.length,
                p50Ms: latency.length ? latency[Math.floor((latency.length - 1) * 0.5)] : null,
                p95Ms: latency.length ? latency[Math.ceil((latency.length - 1) * 0.95)] : null,
                memoryDocuments: memory.length,
                peakMemoryBytes: memory.length
                    ? memory.reduce((max, value) => Math.max(max, value), 0)
                    : null,
            },
        };
    });
    const comparisons = [];
    for (let a = 0; a < series.length; a++)
        for (let b = a + 1; b < series.length; b++) {
            const left = series[a]!,
                right = series[b]!;
            comparisons.push({
                left: left.run.id,
                right: right.run.id,
                direction: "right minus left",
                metrics: allKeys.map((key) => {
                    const first = ratios(
                            sumCounts(left.counts.map((r) => r.get(key) ?? emptyCounts())),
                        ),
                        second = ratios(
                            sumCounts(right.counts.map((r) => r.get(key) ?? emptyCounts())),
                        ),
                        firstBoot = boot(left.counts, key),
                        secondBoot = boot(right.counts, key);
                    return {
                        key,
                        deltas: Object.fromEntries(
                            (Object.keys(first) as (keyof Ratios)[]).map((metric) => [
                                metric,
                                {
                                    difference:
                                        first[metric] !== null && second[metric] !== null
                                            ? second[metric]! - first[metric]!
                                            : null,
                                    interval: percentileInterval(
                                        firstBoot.flatMap((item, i) =>
                                            item[metric] !== null && secondBoot[i]![metric] !== null
                                                ? [secondBoot[i]![metric]! - item[metric]!]
                                                : [],
                                        ),
                                        clusters.length,
                                    ),
                                },
                            ]),
                        ),
                    };
                }),
            });
        }
    return {
        corpus: {
            id: corpus.id,
            version: corpus.version,
            split,
            documents: documents.length,
            independentGroups: clusters.length,
            leakage,
        },
        policy: {
            exactMatch:
                "One-to-one half-open UTF-16 span + category + subtype; duplicate predictions are false positives. Style scored separately. Corrections compare the entire resulting document to accepted reference edits.",
            topK,
            highConfidence: threshold,
            minimum,
            supportedCategories: supported,
            supportedPatterns,
            bootstrapSamples: samples,
            seed: options.seed ?? 20261022,
            intervals:
                "Group-cluster percentile bootstrap for metrics/deltas; Wilson binomial intervals for conservative predeclared gates. Inspect both, especially with clustered or sparse data.",
        },
        systems: systemReports,
        comparisons,
        limitations: [
            "Supplied reference annotations determine correctness; matching does not independently establish semantic validity.",
            "No educational-effectiveness or competitor-quality claim is inferred from fixtures or insufficient category volumes.",
            "Missing confidence, timing, memory, or grouping metadata remains missing; it is never imputed.",
        ],
    };
}
