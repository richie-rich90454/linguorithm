import { describe, expect, it } from "vitest";
import {
    AssessmentService,
    EssayDocument,
    ExerciseSelector,
    MasteryModel,
    MaterialExtractor,
    QuizAssembler,
    buildMutationBank,
    createPipeline,
    exerciseBank,
    exerciseFamily,
    mutationOperators,
    validateExercise,
    validatedMutation,
    type Assessment,
    type Material,
} from "../src";

const now = new Date("2026-10-22T00:00:00Z");
const material = (text: string): Material => ({
    id: "source",
    name: "notes.txt",
    text,
    format: "txt",
    importedAt: now.toISOString(),
});
const bank = buildMutationBank();

describe("conservative source questions", () => {
    it("builds cloze questions with exactly one checked alternative and exact source offsets", () => {
        const source = material(
            "😀\nThe students in the laboratory are ready. She can write an essay. He has a useful book.",
        );
        const cloze = new QuizAssembler()
            .fromMaterial(source)
            .exercises.filter((q) => q.id.includes(":cloze:"));
        expect(cloze).toHaveLength(3);
        for (const question of cloze) {
            expect(validateExercise(question)).toEqual([]);
            const [_, start, end] = /Characters (\d+)–(\d+)/u.exec(question.source.location)!;
            expect(source.text.slice(Number(start) - 1, Number(end))).toBe(question.source.quote);
            const completions = question.options.map((option) =>
                question.sentence.replace("___", option),
            );
            expect(completions[question.answer]).toBe(question.source.quote);
            expect(
                createPipeline().analyze(completions[question.answer]!).diagnostics,
            ).toHaveLength(0);
            expect(
                createPipeline().analyze(completions[1 - question.answer]!).diagnostics,
            ).toHaveLength(1);
        }
    });
    it("abstains on unsupported prose and sentences containing multiple errors", () => {
        const assembler = new QuizAssembler();
        expect(
            assembler.fromMaterial(material("Stars shine in the evening.")).exercises,
        ).toHaveLength(0);
        const questions = assembler.fromMaterial(material("She has wrote a apple.")).exercises;
        expect(questions.filter((q) => /:(?:repair|cloze):/u.test(q.id))).toHaveLength(0);
    });
    it("keeps list and Unicode definition provenance exact", () => {
        const text =
            "😀 Notes\r\n- A noun is a word that names a person, place, thing, or idea.\nA verb is a word that expresses an action or state.";
        const definitions = new MaterialExtractor().analyze({ text }).definitions;
        expect(definitions).toHaveLength(2);
        for (const pair of definitions) expect(text.slice(pair.start, pair.end)).toBe(pair.quote);
        const questions = new QuizAssembler().fromMaterial(material(text)).exercises;
        expect(questions.filter((q) => q.id.includes(":definition:"))).toHaveLength(2);
    });
    it("rejects conflicting and shared definitions before choosing source alternatives", () => {
        const text =
            "Alpha means a red fruit. ALPHA means a blue planet.\nBeta means the red fruit.\nGamma means a red fruit.\nDelta means a tall tree.";
        const questions = new QuizAssembler().fromMaterial(material(text)).exercises;
        expect(questions.filter((q) => q.id.includes(":explicit:"))).toHaveLength(0);
        const incorrect = new QuizAssembler().fromMaterial(
            material("A noun is not a word that names a person, place, thing, or idea."),
        );
        expect(incorrect.exercises.filter((q) => q.id.includes(":definition:"))).toHaveLength(0);
    });
    it("deduplicates consistent source terms and rechecks a complete repair", () => {
        const source = material(
            "Alpha means a small red fruit.\nALPHA means a small red fruit.\nBeta means a tall green tree.\nGamma means a large blue planet.\nShe has wrote an essay.",
        );
        const questions = new QuizAssembler().fromMaterial(source).exercises;
        const definitions = questions.filter((q) => q.id.includes(":explicit:"));
        expect(definitions).toHaveLength(3);
        for (const question of definitions) {
            expect(new Set(question.options.map((s) => s.toLowerCase())).size).toBe(
                question.options.length,
            );
            expect(source.text.toLowerCase()).toContain(
                question.options[question.answer]!.toLowerCase(),
            );
        }
        const repair = questions.find((q) => q.id.includes(":repair:"))!;
        expect(repair.type).toBe("repair");
        expect(repair.acceptedAnswers).toEqual(["She has written an essay."]);
        expect(createPipeline().analyze(repair.options[repair.answer]!).diagnostics).toHaveLength(
            0,
        );
    });
});

describe("controlled mutation families", () => {
    it("has distinct operators whose errors repair exactly to clean originals", () => {
        expect(new Set(bank.map(exerciseFamily)).size).toBe(7);
        for (const operator of mutationOperators) {
            const examples = bank.filter((q) => q.source.location.startsWith(`${operator.id}@`));
            expect(examples.length, operator.id).toBeGreaterThanOrEqual(4);
            for (const question of examples) {
                const pipeline = createPipeline();
                expect(pipeline.analyze(question.source.quote).diagnostics).toHaveLength(0);
                const issues = pipeline.analyze(question.sentence).diagnostics;
                expect(issues).toHaveLength(1);
                expect(issues[0]!.ruleId).toBe(operator.ruleId);
                expect(
                    EssayDocument.create(question.sentence).apply(issues[0]!.proposals[0]!).text,
                ).toBe(question.source.quote);
            }
        }
    });
    it("rejects dirty sources, unrelated changes and the wrong target rule", () => {
        const operator = mutationOperators.find((op) => op.id === "modal-base")!;
        expect(validatedMutation("She can write a apple.", operator, "dirty")).toBeUndefined();
        expect(
            validatedMutation(
                "She can write an essay.",
                { ...operator, mutate: () => "She can writes a book." },
                "changed",
            ),
        ).toBeUndefined();
        expect(
            validatedMutation(
                "She can write an essay.",
                { ...operator, ruleId: "agreement" },
                "wrong-rule",
            ),
        ).toBeUndefined();
    });
});

describe("review and assessment selection", () => {
    it("serves the earliest due skill before a less overdue weaker skill", () => {
        const model = new MasteryModel();
        const states = [
            { ...model.initial("agreement", now), mastery: 0.1, due: "2026-10-21T00:00:00Z" },
            { ...model.initial("pronouns", now), mastery: 0.9, due: "2026-10-01T00:00:00Z" },
        ];
        const questions = exerciseBank.filter((q) => ["agreement", "pronouns"].includes(q.skill));
        expect(new ExerciseSelector().select(questions, states, [], undefined, now)?.skill).toBe(
            "pronouns",
        );
    });
    it("prefers another construction over a cosmetic variant of the latest question", () => {
        const first = bank[0]!,
            cosmetic = bank[1]!,
            different = exerciseBank.find((q) => q.id === "agreement-4")!;
        const selected = new ExerciseSelector().select(
            [first, cosmetic, different],
            [],
            [first.id],
            "agreement",
            now,
        );
        expect(selected?.id).toBe(different.id);
        expect(exerciseFamily(first)).toBe(exerciseFamily(cosmetic));
    });
    it("does not treat unseen IDs from a practiced family as transfer", () => {
        const service = new AssessmentService();
        const first = bank[0]!,
            cosmetic = bank[1]!,
            novel = bank.find((q) => q.id.startsWith("mutation:modal-base:"))!;
        const previous: Assessment = {
            id: "pre",
            phase: "pretest",
            startedAt: now.toISOString(),
            completedAt: now.toISOString(),
            dueAt: now.toISOString(),
            exerciseIds: [first.id],
            answers: [
                {
                    exerciseId: first.id,
                    answer: first.answer,
                    correct: true,
                    at: now.toISOString(),
                },
            ],
        };
        const transfer = service.start(
            "transfer",
            [first, cosmetic, novel],
            [],
            [previous],
            now,
            1,
        );
        expect(transfer.exerciseIds).toEqual([novel.id]);
        expect(() => service.start("transfer", [first, cosmetic], [], [previous], now, 1)).toThrow(
            /unfamiliar constructions/u,
        );
        expect(() => service.start("pretest", bank, [], [], now, 0)).toThrow(/size/u);
    });
});
