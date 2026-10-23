import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    EssayDocument,
    MasteryModel,
    QuizAssembler,
    ReviewScheduler,
    SkillGraph,
    Tokenizer,
    SentenceSegmenter,
    backupSchema,
    createPipeline,
    editDistance,
    exerciseBank,
    validateExercise,
    type Attempt,
    type Material,
} from "../src";

describe("source preservation", () => {
    it("keeps UTF-16 offsets including astral characters, accents and CRLF", () => {
        const text = "😀 Café students are ready.\r\n\r\nShe has wrote an essay.";
        const report = createPipeline().analyze(text);
        for (const s of report.sentences) {
            expect(text.slice(s.start, s.end)).toBe(s.text);
            for (const t of s.tokens) expect(text.slice(t.start, t.end)).toBe(t.text);
        }
        const d = report.diagnostics.find((d) => d.ruleId === "verb-form")!;
        expect(text.slice(d.start, d.end)).toBe("wrote");
    });
    it("handles abbreviations and decimals", () => {
        const sentences = new SentenceSegmenter().segment(
            "Dr. Smith measured 3.14 meters. She wrote a note.",
        );
        expect(sentences).toHaveLength(2);
        expect(sentences[0]!.text).toBe("Dr. Smith measured 3.14 meters.");
    });
    it("all tokens are exact source slices", () =>
        fc.assert(
            fc.property(fc.string(), (text) => {
                for (const t of new Tokenizer().tokenize(text))
                    expect(text.slice(t.start, t.end)).toBe(t.text);
            }),
            { numRuns: 300 },
        ));
    it("analysis never crashes and every finding maps to the original", () =>
        fc.assert(
            fc.property(fc.string({ maxLength: 3000 }), (text) => {
                const report = createPipeline().analyze(text);
                for (const d of report.diagnostics) {
                    expect(d.start).toBeGreaterThanOrEqual(0);
                    expect(d.end).toBeLessThanOrEqual(text.length);
                    for (const p of d.proposals)
                        for (const e of p.edits)
                            expect(text.slice(e.start, e.end)).toBe(e.expected);
                }
            }),
            { numRuns: 200 },
        ));
    it("remaps cached paragraphs after insertion", () => {
        const pipeline = createPipeline();
        pipeline.analyze("She has wrote an essay.");
        const text = "😀 A new opening.\n\nShe has wrote an essay.";
        const report = pipeline.analyze(text);
        expect(report.cachedParagraphs).toBe(1);
        const d = report.diagnostics.find((d) => d.ruleId === "verb-form")!;
        expect(text.slice(d.start, d.end)).toBe("wrote");
        expect(d.proposals[0]!.edits[0]!.expected).toBe("wrote");
    });
});

describe("correction transactions", () => {
    it("apply, undo and redo preserve unrelated Unicode", () =>
        fc.assert(
            fc.property(
                fc.string({ maxLength: 100 }),
                fc.string({ maxLength: 100 }),
                (before, after) => {
                    const doc = EssayDocument.create(before + "recieve" + after);
                    const correction = {
                        id: "test",
                        label: "Spelling",
                        provenance: "test",
                        edits: [
                            {
                                type: "REPLACE" as const,
                                start: before.length,
                                end: before.length + 7,
                                expected: "recieve",
                                replacement: "receive",
                            },
                        ],
                    };
                    const updated = doc.apply(correction);
                    expect(updated.text).toBe(before + "receive" + after);
                    expect(updated.undo().text).toBe(doc.text);
                    expect(updated.undo().redo().text).toBe(updated.text);
                },
            ),
            { numRuns: 300 },
        ));
    it("rejects stale and overlapping edits", () => {
        const doc = EssayDocument.create("hello world");
        expect(() =>
            doc.apply({
                id: "x",
                label: "x",
                provenance: "test",
                edits: [
                    { type: "REPLACE", start: 0, end: 5, expected: "wrong", replacement: "hi" },
                ],
            }),
        ).toThrow(/stale/u);
        expect(() =>
            doc.apply({
                id: "x",
                label: "x",
                provenance: "test",
                edits: [
                    { type: "DELETE", start: 0, end: 5, expected: "hello", replacement: "" },
                    { type: "REPLACE", start: 4, end: 7, expected: "o w", replacement: "" },
                ],
            }),
        ).toThrow();
    });
    it("forks history after undo without altering original", () => {
        const original = EssayDocument.create("a");
        const d = original.revise("b", "edit").revise("c", "edit").undo().revise("d", "edit");
        expect(original.text).toBe("a");
        expect(d.text).toBe("d");
        expect(d.redo().text).toBe("d");
        expect(d.undo().text).toBe("b");
    });
});

describe("grammar constraints and valid controls", () => {
    const pipeline = createPipeline();
    const cases: [string, string, string][] = [
        ["The collection of essays are on the desk.", "agreement", "is"],
        ["The students in the laboratory is ready.", "agreement", "are"],
        ["She walk to school.", "agreement", "walks"],
        ["They goes home.", "agreement", "go"],
        ["She has wrote three essays.", "verb-form", "written"],
        ["He can goes home.", "verb-form", "go"],
        ["It is a hour away.", "article-sound", "an"],
        ["It is an useful book.", "article-sound", "a"],
        ["I recieve letters.", "spelling", "receive"],
        ["However the work continues.", "introductory-comma", ","],
        ["I work, she works.", "comma-splice", ";"],
    ];
    it.each(cases)("detects %s", (text, rule, replacement) => {
        const d = pipeline.analyze(text).diagnostics.find((d) => d.ruleId === rule);
        expect(d).toBeDefined();
        expect(d!.proposals[0]!.edits[0]!.replacement).toBe(replacement);
        const corrected = EssayDocument.create(text).apply(d!.proposals[0]!);
        expect(
            pipeline.analyze(corrected.text).diagnostics.filter((d) => d.ruleId === rule),
        ).toHaveLength(0);
    });
    it.each([
        "The collection of essays is on the desk.",
        "The students in the laboratory are ready.",
        "She ate an apple.",
        "She wrote a book.",
        "If I were ready, I would go.",
        "You are ready.",
        "The team are celebrating.",
        "The book that the students borrowed is here.",
        "There are several reasons.",
        "They have had enough.",
        "I had had enough.",
        "I know that that is correct.",
        "The quokka and X Æ A-12 arrived.",
        "They read books.",
        "An hour is enough.",
        "A university is nearby.",
        "Listen.",
        "The evidence is limited, but the conclusion is convincing.",
    ])("abstains on valid control: %s", (text) =>
        expect(
            pipeline.analyze(text).diagnostics.filter((d) => d.certainty !== "Possible issue"),
        ).toHaveLength(0),
    );
    it("keeps document style opt-in", () => {
        const text = "We can learn slowly. We can learn together. We can learn independently.";
        expect(pipeline.analyze(text).diagnostics.some((d) => d.category === "Style")).toBe(false);
        expect(
            pipeline.analyze(text, 0, true).diagnostics.find((d) => d.category === "Style")
                ?.evidence,
        ).toHaveLength(3);
    });
    it("does not mark arbitrary unknown words as misspellings", () =>
        expect(pipeline.analyze("Quasiperiodicity informs xenobiology.").diagnostics).toHaveLength(
            0,
        ));
    it("handles transpositions", () => expect(editDistance("teh", "the")).toBe(1));
});

describe("learning and material validation", () => {
    it("validates every authored question", () => {
        for (const q of exerciseBank) expect(validateExercise(q), q.id).toEqual([]);
        expect(new Set(exerciseBank.map((q) => q.id)).size).toBe(exerciseBank.length);
        new SkillGraph();
    });
    it("updates BKT and distinguishes hinted success", () => {
        const model = new MasteryModel(),
            state = model.initial("agreement");
        const attempt: Attempt = {
            id: "1",
            exerciseId: "1",
            skill: "agreement",
            correct: true,
            answer: 0,
            hints: 0,
            at: "2026-10-22T00:00:00.000Z",
        };
        const good = model.update(state, attempt),
            hinted = model.update(state, { ...attempt, hints: 1 }),
            wrong = model.update(state, { ...attempt, correct: false });
        expect(good.mastery).toBeGreaterThan(hinted.mastery);
        expect(hinted.correct).toBe(0);
        expect(wrong.mastery).toBeLessThan(good.mastery);
        expect(good.correct).toBe(1);
    });
    it("review intervals remain bounded and valid", () =>
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 1, noNaN: true }),
                fc.integer({ min: 0, max: 365 }),
                fc.boolean(),
                (m, i, correct) => {
                    const result = new ReviewScheduler().schedule(m, i, correct);
                    expect(Number.isFinite(Date.parse(result.due))).toBe(true);
                    expect(result.interval).toBeGreaterThanOrEqual(1);
                    expect(result.interval).toBeLessThanOrEqual(365);
                },
            ),
        ));
    it("constructs grounded questions and abstains on unsupported prose", () => {
        const material: Material = {
            id: "test",
            name: "notes.txt",
            text: "A noun is a word that names a person, place, thing, or idea. A verb is a word that expresses an action or state.",
            importedAt: "2026-10-22T00:00:00.000Z",
            format: "txt",
        };
        const quiz = new QuizAssembler().fromMaterial(material);
        expect(quiz.exercises).toHaveLength(2);
        for (const q of quiz.exercises) {
            expect(validateExercise(q)).toEqual([]);
            expect(material.text).toContain(q.source.quote);
        }
        expect(
            new QuizAssembler().fromMaterial({ ...material, text: "Stars shine in the evening." })
                .exercises,
        ).toHaveLength(0);
    });
    it("rejects invalid backup revisions and unknown formats", () => {
        expect(backupSchema.safeParse({ format: "unknown" }).success).toBe(false);
        const data = {
            format: "syntax-backup",
            version: 1,
            exportedAt: new Date().toISOString(),
            documents: [{ ...EssayDocument.create().record, cursor: 3 }],
            skills: [],
            attempts: [],
            materials: [],
        };
        expect(backupSchema.safeParse(data).success).toBe(false);
    });
});
