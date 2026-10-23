import { describe, expect, it } from "vitest";
import {
    annotatedCorpusSchema,
    annotatedDocumentSchema,
    annotatedErrorSchema,
    annotationAgreement,
    checkCorrectionIntegrity,
    compareSystems,
    inspectSplitLeakage,
    systemRunSchema,
    validUtf16Span,
    wilsonInterval,
    type AnnotatedCorpus,
    type AnnotatedDocument,
    type AnnotatedError,
    type SystemRun,
} from "../src/annotations";

// Original hand-authored fixtures test accounting only; they are not benchmark evidence.
function exampleDocument(id = "essay-1", text = "🦉 She write today."): AnnotatedDocument {
    const document: AnnotatedDocument = {
        id,
        text,
        variety: "en-US",
        split: "test",
        groups: { authorId: `author-${id}`, sourceId: `source-${id}`, promptId: `prompt-${id}` },
        provenance: {
            source: "Original unit fixture",
            license: "Project-owned fixture",
            permittedUse: ["testing"],
            consent: "not-required",
        },
        reviewStatus: "adjudicated",
        validControl: !text.includes("write"),
        sentences: [{ id: `${id}-s1`, start: 0, end: text.length, text }],
        errors: [],
    };
    const start = text.indexOf("write");
    if (start >= 0)
        document.errors.push({
            id: `${id}-e1`,
            documentId: id,
            sentenceId: `${id}-s1`,
            start,
            end: start + 5,
            original: "write",
            corrected: "writes",
            acceptedAlternatives: ["is writing"],
            category: "Grammar",
            subtype: "subject-verb-agreement",
            relationship: {
                type: "subject-predicate",
                evidence: [
                    {
                        start: text.indexOf("She"),
                        end: text.indexOf("She") + 3,
                        text: "She",
                        role: "subject",
                    },
                ],
            },
            confidence: 1,
            severity: "moderate",
            isStyle: false,
            annotators: [
                {
                    id: "reviewer-a",
                    version: "guidelines-1",
                    method: "manual",
                    source: "Unit fixture",
                    at: "2026-10-22T00:00:00Z",
                },
            ],
            adjudication: {
                status: "adjudicated",
                by: "reviewer-c",
                at: "2026-10-22T00:00:00Z",
                rationale: "Test fixture reviewed for source offsets.",
            },
        });
    return annotatedDocumentSchema.parse(document);
}
function exampleCorpus(): AnnotatedCorpus {
    return annotatedCorpusSchema.parse({
        format: "grammar-annotations",
        id: "original-fixtures",
        version: "1",
        description: "Original unit fixtures only",
        documents: [exampleDocument(), exampleDocument("control", "The notebook is blue.")],
    });
}
function exampleRun(corpus: AnnotatedCorpus, id = "system-a"): SystemRun {
    return systemRunSchema.parse({
        format: "grammar-predictions",
        id,
        version: "fixture-1",
        corpusId: corpus.id,
        corpusVersion: corpus.version,
        kind: "full",
        settings: { variety: "en-US", fixture: true },
        omittedComponents: [],
        documents: corpus.documents.map((d) => ({
            documentId: d.id,
            text: d.text,
            predictions: d.errors.map((e) => ({
                id: `${e.id}-prediction`,
                start: e.start,
                end: e.end,
                original: e.original,
                category: e.category,
                subtype: e.subtype,
                confidence: 0.99,
                candidates: [
                    {
                        edits: [
                            {
                                start: e.start,
                                end: e.end,
                                expected: e.original,
                                replacement: e.corrected,
                            },
                        ],
                    },
                ],
            })),
        })),
    });
}
const fastOptions = { bootstrapSamples: 50, seed: 7 };
const overall = (report: ReturnType<typeof compareSystems>) =>
    report.systems[0]!.metrics.find((m) => m.key === "overall")!;

describe("annotated source schemas", () => {
    it("preserves UTF-16 offsets, zero-width insertion sites, and literal source text", () => {
        const document = exampleDocument();
        expect(document.errors[0]!.start).toBe(7);
        expect(validUtf16Span(document.text, 0, 2)).toBe(true);
        expect(validUtf16Span(document.text, 0, 1)).toBe(false);
        expect(validUtf16Span(document.text, document.text.length, document.text.length)).toBe(
            true,
        );
        expect(validUtf16Span(document.text, 2.5, 3)).toBe(false);
        const insertion = structuredClone(document);
        insertion.errors[0] = {
            ...insertion.errors[0]!,
            start: document.text.length - 1,
            end: document.text.length - 1,
            original: "",
            corrected: ", perhaps",
            acceptedAlternatives: [],
        };
        expect(annotatedDocumentSchema.safeParse(insertion).success).toBe(true);
        const halfEmoji = structuredClone(document);
        halfEmoji.errors[0] = {
            ...halfEmoji.errors[0]!,
            start: 0,
            end: 1,
            original: document.text.slice(0, 1),
        };
        expect(annotatedDocumentSchema.safeParse(halfEmoji).success).toBe(false);
    });
    it("rejects stale sources, wrong sentence/document identities, style conflation, and incomplete adjudication", () => {
        const document = exampleDocument(),
            error = document.errors[0]!;
        expect(
            annotatedDocumentSchema.safeParse({
                ...document,
                errors: [{ ...error, original: "wrote" }],
            }).success,
        ).toBe(false);
        expect(
            annotatedDocumentSchema.safeParse({
                ...document,
                errors: [{ ...error, sentenceId: "missing" }],
            }).success,
        ).toBe(false);
        expect(
            annotatedDocumentSchema.safeParse({
                ...document,
                errors: [{ ...error, documentId: "other" }],
            }).success,
        ).toBe(false);
        expect(annotatedErrorSchema.safeParse({ ...error, isStyle: true }).success).toBe(false);
        expect(
            annotatedErrorSchema.safeParse({ ...error, adjudication: { status: "agreed" } })
                .success,
        ).toBe(false);
        expect(
            annotatedErrorSchema.safeParse({ ...error, adjudication: { status: "adjudicated" } })
                .success,
        ).toBe(false);
        expect(
            annotatedErrorSchema.safeParse({ ...error, acceptedAlternatives: [error.corrected] })
                .success,
        ).toBe(false);
        expect(annotatedDocumentSchema.safeParse({ ...document, validControl: true }).success).toBe(
            false,
        );
        expect(
            annotatedDocumentSchema.safeParse({ ...document, unknown: "silently discarded" })
                .success,
        ).toBe(false);
    });
    it("detects transitive split risks from every available group and normalized duplicates", () => {
        const first = exampleDocument(),
            second = exampleDocument("essay-2", "She write another paragraph.");
        second.split = "train";
        second.groups = { ...first.groups };
        const grouped = inspectSplitLeakage([first, second]);
        expect(grouped.passed).toBe(false);
        expect(grouped.leaks.map((l) => l.field)).toEqual(["authorId", "sourceId", "promptId"]);
        const duplicate = exampleDocument("duplicate");
        duplicate.split = "validation";
        duplicate.groups = {};
        expect(
            inspectSplitLeakage([first, duplicate]).leaks.some((l) => l.field === "normalizedText"),
        ).toBe(true);
        expect(inspectSplitLeakage([duplicate]).missingGroupMetadata).toEqual({
            authorId: 1,
            sourceId: 1,
            promptId: 1,
        });
    });
});

describe("independent annotation review", () => {
    it("uses one-to-one span/category/subtype agreement and does not invent negative labels", () => {
        const corpus = exampleCorpus(),
            error = corpus.documents[0]!.errors[0]!;
        const other: AnnotatedError = {
            ...error,
            corrected: "is writing",
            acceptedAlternatives: ["writes"],
            annotators: [{ ...error.annotators[0]!, id: "reviewer-b" }],
        };
        const review = annotationAgreement(corpus, [
            {
                annotatorId: "reviewer-a",
                documents: [
                    { documentId: "essay-1", errors: [error] },
                    { documentId: "control", errors: [] },
                ],
            },
            {
                annotatorId: "reviewer-b",
                documents: [
                    { documentId: "essay-1", errors: [other] },
                    { documentId: "control", errors: [] },
                ],
            },
        ]);
        expect(review.pairs[0]).toMatchObject({
            sharedDocuments: 2,
            emptyAgreements: 1,
            exactMatches: 1,
            detectionF1: 1,
            preferredCorrectionAgreement: 0,
            acceptableCorrectionOverlap: 1,
            labelUnits: 1,
            cohenKappa: null,
        });
        expect(review.adjudication.pendingDocuments).toEqual([]);
        expect(review.adjudication.statuses.adjudicated).toBe(1);
        expect(() =>
            annotationAgreement(corpus, [
                {
                    annotatorId: "reviewer-a",
                    documents: [{ documentId: "essay-1", errors: [error] }],
                },
                {
                    annotatorId: "reviewer-b",
                    documents: [{ documentId: "essay-1", errors: [error] }],
                },
            ]),
        ).toThrow("provenance");
    });
    it("reports pending adjudication and excludes unreviewed corpora from evaluation", () => {
        const corpus = exampleCorpus();
        corpus.documents[0]!.errors[0]!.adjudication = { status: "unreviewed" };
        expect(() => compareSystems(corpus, [exampleRun(corpus)], fastOptions)).toThrow(
            "adjudicated",
        );
        corpus.documents[0]!.errors[0]!.adjudication = { status: "agreed" };
        expect(annotatedCorpusSchema.safeParse(corpus).success).toBe(false);
    });
});

describe("frozen system comparison", () => {
    it("counts duplicate detections as FP, correction rank, abstention, controls, and calibration separately", () => {
        const corpus = exampleCorpus(),
            run = exampleRun(corpus);
        const prediction = run.documents[0]!.predictions[0]!;
        prediction.candidates.unshift({
            edits: [
                {
                    start: prediction.start,
                    end: prediction.end,
                    expected: "write",
                    replacement: "wrote",
                },
            ],
        });
        run.documents[0]!.predictions.push({
            ...structuredClone(prediction),
            id: "duplicate",
            confidence: 0.7,
        });
        run.documents[1]!.predictions.push({
            id: "false-positive",
            start: 0,
            end: 3,
            original: "The",
            category: "Grammar",
            subtype: "subject-verb-agreement",
            confidence: 0.9,
            candidates: [],
        });
        const report = compareSystems(corpus, [run], { ...fastOptions, topK: 2 });
        const metric = overall(report);
        expect(metric.counts).toMatchObject({
            tp: 1,
            fp: 2,
            fn: 0,
            correctFirst: 0,
            correctTopK: 1,
            correctionAttempts: 2,
        });
        expect(metric.precision).toBeCloseTo(1 / 3);
        expect(metric.recall).toBe(1);
        expect(metric.f05).toBeCloseTo(1.25 / 3.25);
        expect(metric.topKAcceptableAmongGold).toBe(1);
        expect(metric.top1CorrectionAccuracy).toBe(0);
        expect(metric.highConfidencePrecision).toBe(1);
        expect(report.systems[0]!.validControls).toMatchObject({
            count: 1,
            falsePositiveDocuments: 1,
            highConfidenceFalsePositiveDocuments: 0,
        });
        expect(report.systems[0]!.calibration.brierScore).toBeCloseTo((0.0001 + 0.49 + 0.81) / 3);
    });
    it("compares entire corrected documents, rejecting unrelated edits and invalid candidate sources", () => {
        const corpus = exampleCorpus(),
            run = exampleRun(corpus),
            prediction = run.documents[0]!.predictions[0]!;
        prediction.candidates[0]!.edits.push({
            start: 0,
            end: 2,
            expected: "🦉",
            replacement: "Bird",
        });
        prediction.candidates.push({
            edits: [
                {
                    start: prediction.start,
                    end: prediction.end,
                    expected: "wrote",
                    replacement: "writes",
                },
            ],
        });
        const metric = overall(compareSystems(corpus, [run], fastOptions));
        expect(metric.counts).toMatchObject({
            tp: 1,
            correctFirst: 0,
            correctTopK: 0,
            validCandidates: 1,
            candidates: 2,
        });
        expect(metric.correctionIntegrity).toBe(0.5);
        expect(
            checkCorrectionIntegrity("abc def", [
                { start: 0, end: 3, expected: "abc", replacement: "A" },
                { start: 4, end: 7, expected: "def", replacement: "DEFG" },
            ]),
        ).toEqual({ valid: true, undoExact: true, result: "A DEFG" });
        expect(
            checkCorrectionIntegrity("abc", [
                { start: 0, end: 2, expected: "ab", replacement: "x" },
                { start: 1, end: 3, expected: "bc", replacement: "y" },
            ]).valid,
        ).toBe(false);
        expect(
            checkCorrectionIntegrity("🦉", [
                { start: 0, end: 1, expected: "\ud83e", replacement: "x" },
            ]).valid,
        ).toBe(false);
    });
    it("leaves unknown confidence/timing missing and separates optional style diagnostics", () => {
        const corpus = exampleCorpus(),
            run = exampleRun(corpus);
        run.documents[0]!.predictions[0]!.confidence = null;
        run.documents[1]!.predictions.push({
            id: "style",
            start: 4,
            end: 12,
            original: "notebook",
            category: "Style",
            subtype: "word-choice",
            confidence: 0.8,
            candidates: [],
        });
        const report = compareSystems(corpus, [run], fastOptions);
        expect(overall(report).precision).toBe(1);
        expect(report.systems[0]!.calibration).toMatchObject({
            knownConfidence: 0,
            unknownConfidence: 1,
            brierScore: null,
        });
        expect(report.systems[0]!.performance).toMatchObject({
            p50Ms: null,
            peakMemoryBytes: null,
        });
        expect(report.systems[0]!.validControls.falsePositiveDocuments).toBe(0);
        expect(report.systems[0]!.metrics.find((m) => m.key === "style")!.counts.fp).toBe(1);
    });
    it("provides reproducible paired group-bootstrap deltas and explicit failed small-volume gates", () => {
        const corpus = exampleCorpus(),
            run = exampleRun(corpus),
            ablation = structuredClone(run);
        ablation.id = "without-agreement-rule";
        ablation.kind = "ablation";
        ablation.omittedComponents = ["agreement-rule"];
        ablation.documents[0]!.predictions = [];
        const options = { ...fastOptions, supportedCategories: ["Grammar" as const] };
        const report = compareSystems(corpus, [run, ablation], options);
        expect(compareSystems(corpus, [run, ablation], options)).toEqual(report);
        const delta = report.comparisons[0]!.metrics.find((m) => m.key === "overall")!.deltas
            .recall;
        expect(delta!.difference).toBe(-1);
        const grammar = report.systems[0]!.metrics.find((m) => m.key === "category:Grammar")!;
        expect(grammar.releaseGate.status).toBe("failed");
        expect(grammar.releaseGate.reasons).toContain("Insufficient reference errors.");
        expect(report.systems[0]!.metrics.find((m) => m.key === "style")!.releaseGate.status).toBe(
            "not-declared",
        );
    });
    it("refuses leaking, incomplete, stale, or mismatched run input", () => {
        const corpus = exampleCorpus(),
            run = exampleRun(corpus);
        expect(() =>
            compareSystems(corpus, [{ ...run, corpusVersion: "other" }], fastOptions),
        ).toThrow("version mismatch");
        expect(() =>
            compareSystems(corpus, [{ ...run, documents: [run.documents[0]!] }], fastOptions),
        ).toThrow("exactly");
        run.documents[0]!.text += " ";
        expect(() => compareSystems(corpus, [run], fastOptions)).toThrow("Stale");
        const training = structuredClone(corpus.documents[0]!);
        training.id = "training-copy";
        training.errors = [];
        training.split = "train";
        corpus.documents.push(training);
        expect(() => compareSystems(corpus, [exampleRun(corpus)], fastOptions)).toThrow("leakage");
    });
    it("reports zero denominators as null and rejects invalid Wilson counts", () => {
        const corpus = exampleCorpus(),
            run = exampleRun(corpus);
        run.documents[0]!.predictions = [];
        const metric = overall(compareSystems(corpus, [run], fastOptions));
        expect(metric.precision).toBeNull();
        expect(metric.recall).toBe(0);
        expect(metric.f05).toBe(0);
        expect(wilsonInterval(0, 0)).toBeNull();
        expect(wilsonInterval(1, 1)!.lower).toBeLessThan(1);
        expect(() => wilsonInterval(2, 1)).toThrow();
    });
});
