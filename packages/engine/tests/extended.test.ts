import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    AssessmentService,
    EssayDocument,
    HybridAnalysisPipeline,
    MaterialExtractor,
    MasteryModel,
    ReviewQueue,
    Tokenizer,
    buildMutationBank,
    createPipeline,
    editDistance,
    exerciseBank,
    validateExercise,
    type Attempt,
    type Sentence,
} from "../src";

describe("extended learning contracts", () => {
    it("validates each generated mutation and its exact repair", () => {
        const bank = buildMutationBank();
        expect(bank.length).toBeGreaterThanOrEqual(32);
        for (const q of bank) {
            expect(validateExercise(q)).toEqual([]);
            const report = createPipeline().analyze(q.sentence);
            expect(report.diagnostics).toHaveLength(1);
            expect(
                EssayDocument.create(q.sentence).apply(report.diagnostics[0]!.proposals[0]!).text,
            ).toBe(q.acceptedAnswers![0]);
        }
    });
    it("separates assessment items, rejects duplicate answers, enforces delayed review", () => {
        const service = new AssessmentService(),
            bank = [...exerciseBank, ...buildMutationBank()],
            now = new Date("2026-01-01T00:00:00Z");
        let pre = service.start("pretest", bank, [], [], now);
        expect(() => service.start("posttest", bank, [], [])).toThrow(/pretest/u);
        for (const id of pre.exerciseIds) {
            const q = bank.find((item) => item.id === id)!;
            pre = service.answer(pre, q, q.answer, now);
        }
        expect(pre.completedAt).toBeTruthy();
        expect(() =>
            service.answer(
                pre,
                bank.find((q) => q.id === pre.exerciseIds[0])!,
                0,
            ),
        ).toThrow();
        const post = service.start("posttest", bank, [], [pre], now);
        expect(post.exerciseIds.every((id) => !pre.exerciseIds.includes(id))).toBe(true);
        expect(() =>
            service.start(
                "delayed",
                bank,
                [],
                [pre, { ...post, completedAt: now.toISOString() }],
                now,
            ),
        ).toThrow(/seven days/u);
        expect(
            service.start(
                "delayed",
                bank,
                [],
                [pre, { ...post, completedAt: now.toISOString() }],
                new Date("2026-01-09"),
            ).exerciseIds,
        ).toHaveLength(5);
    });
    it("excludes unrecognized repair responses from assessment accuracy", () => {
        const service = new AssessmentService(),
            repair = buildMutationBank()[0]!,
            now = new Date("2026-01-01T00:00:00Z"),
            session = service.start("pretest", [repair], [], [], now, 1),
            completed = service.answer(session, repair, undefined, now, true),
            pretest = service.summary([completed]).find((item) => item.phase === "pretest");
        expect(pretest).toMatchObject({
            completed: 1,
            correct: 0,
            total: 0,
            reviewRequired: 1,
            accuracy: null,
        });
    });
    it("does not treat repeated success as independent evidence", () => {
        const model = new MasteryModel(),
            state = model.initial("agreement"),
            attempt: Attempt = {
                id: "a",
                exerciseId: "q",
                skill: "agreement",
                answer: 0,
                correct: true,
                hints: 0,
                at: "2026-01-01T00:00:00Z",
                attemptNumber: 2,
            };
        const updated = model.update(state, attempt);
        expect(updated.correct).toBe(0);
        expect(updated.mastery).toBeLessThan(
            model.update(state, { ...attempt, attemptNumber: 1 }).mastery,
        );
    });
    it("does not update mastery from a response requiring human review", () => {
        const model = new MasteryModel(),
            state = model.initial("agreement"),
            updated = model.update(state, {
                id: "review",
                exerciseId: "repair",
                skill: "agreement",
                correct: false,
                hints: 0,
                at: "2026-01-01T00:00:00Z",
                reviewRequired: true,
            });
        expect(updated).toBe(state);
    });
    it("returns due reviews in order under arbitrary insertion", () => {
        fc.assert(
            fc.property(fc.array(fc.integer({ min: 0, max: 1000 })), (values) => {
                const queue = new ReviewQueue<number>();
                for (const n of values) queue.push(n, n);
                expect(queue.due(500)).toEqual(
                    values.filter((n) => n <= 500).sort((a, b) => a - b),
                );
                expect(queue.size).toBe(values.filter((n) => n > 500).length);
            }),
        );
    });
});
describe("lexical and material boundaries", () => {
    it("implements unrestricted transposition distance", () => {
        expect(editDistance("CA", "ABC")).toBe(2);
        expect(editDistance("recieve", "receive")).toBe(1);
    });
    it("preserves contracted token spans", () => {
        const text = "😀 She doesn't know O'Connor. We’re ready.";
        for (const token of new Tokenizer().tokenize(text))
            expect(text.slice(token.start, token.end)).toBe(token.text);
        expect(new Tokenizer().tokenize("doesn't").map((t) => t.text)).toEqual(["does", "n't"]);
    });
    it("retains source blocks and exact definition evidence", () => {
        const text =
            "# Grammar\n[Page 2]\n- A clause is a group of words with a predicate.\nTerm | Meaning\nA noun is a word that names something.";
        const result = new MaterialExtractor().analyze({ text });
        expect(result.blocks.map((b) => b.kind)).toEqual([
            "heading",
            "page",
            "list",
            "table",
            "paragraph",
        ]);
        for (const block of result.blocks)
            expect(text.slice(block.start, block.end)).toBe(block.text);
        expect(result.definitions.some((d) => d.term.toLowerCase() === "noun")).toBe(true);
        expect(result.keyPhrases.length).toBeGreaterThan(0);
    });
    it("reuses neural sentences while remapping source offsets", async () => {
        let calls = 0;
        const pipeline = new HybridAnalysisPipeline({
            lexicon: { frequency: {} },
            metadata: { version: "test", limitations: [] },
            sentence: async (s: Sentence) => {
                calls++;
                return s;
            },
        });
        await pipeline.analyze("Students are ready.");
        const report = await pipeline.analyze("\n\nStudents are ready.");
        expect(calls).toBe(1);
        for (const s of report.sentences)
            for (const t of s.tokens) expect(report.text.slice(t.start, t.end)).toBe(t.text);
    });
});
