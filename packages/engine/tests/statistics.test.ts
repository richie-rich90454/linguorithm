import { describe, expect, it } from "vitest";
import { NgramLanguageModel, PlattCalibration, viterbi, createPipeline } from "../src";

describe("statistical interfaces", () => {
    it("CRF transitions can outweigh greedy token choices", () => {
        expect(
            viterbi(
                [
                    [3, 2],
                    [0, 4],
                ],
                [
                    [5, -10],
                    [-10, 5],
                ],
                [0, 0],
                [0, 0],
            ),
        ).toEqual([1, 1]);
        expect(viterbi([], [], [], [])).toEqual([]);
        expect(() =>
            viterbi(
                [[1, NaN]],
                [
                    [0, 0],
                    [0, 0],
                ],
                [0, 0],
                [0, 0],
            ),
        ).toThrow();
    });
    it("contextual scores rank observed sequences without generating text", () => {
        const model = new NgramLanguageModel([
            ["students", "write"],
            ["students", "write"],
            ["a", "student", "writes"],
        ]);
        expect(model.score(["students", "write"])).toBeGreaterThan(
            model.score(["students", "writes"]),
        );
        expect(Number.isFinite(model.score(["unfamiliar", "words"]))).toBe(true);
    });
    it("calibration is bounded and requires provenance", () => {
        const model = new PlattCalibration(1, 0, "held-out-set-1");
        expect(model.probability(0)).toBe(0.5);
        expect(model.probability(10000)).toBe(1);
        expect(model.probability(-10000)).toBe(0);
        expect(() => new PlattCalibration(1, 0, "")).toThrow();
    });
    it("style evidence preserves whitespace and punctuation offsets", () => {
        const text = "“We   can learn today.” We can learn tomorrow. We can learn together.";
        const d = createPipeline()
            .analyze(text, 0, true)
            .diagnostics.find((d) => d.category === "Style")!;
        expect(d).toBeDefined();
        expect(text.slice(d.evidence[0]!.start, d.evidence[0]!.end)).toBe("We   can learn");
    });
    it("corrections carry revalidation evidence", () => {
        const d = createPipeline().analyze("She has wrote an essay.").diagnostics[0]!;
        expect(d.proposals[0]!.validation?.status).toBe("rechecked");
    });
    it("nominal gerunds and dependency heads are represented structurally", () => {
        const s = createPipeline().analyze("Good writing begins with careful observation.")
            .sentences[0]!;
        expect(s.tokens[1]!.pos).toBe("NOUN");
        expect(s.tokens[2]!.pos).toBe("VERB");
        expect(s.graph.find((e) => e.relation === "nsubj")).toEqual({
            head: 2,
            dependent: 1,
            relation: "nsubj",
        });
        expect(s.graph.find((e) => e.dependent === 5)?.head).toBe(3);
    });
    it.each([
        "James is ready.",
        "Physics is interesting.",
        "The basis is clear.",
        "The quokka is ready.",
    ])("does not infer grammatical number from unknown names or vocabulary: %s", (text) => {
        expect(createPipeline().analyze(text).diagnostics).toEqual([]);
    });
});
