import { describe, expect, it } from "vitest";
import { EssayDocument } from "../src/domain";
import { createPipeline } from "../src/pipeline";

describe("sentence conventions in the public analysis pipeline", () => {
    it("offers a source-checked capitalization suggestion for a sentence opening", () => {
        const report = createPipeline().analyze("tomorrow we will go home.");
        const finding = report.diagnostics.find(
            (item) => item.ruleId === "sentence-capitalization",
        );

        expect(finding?.goalId).toBe("writing.capitals");
        expect(finding?.proposals).toHaveLength(1);
        expect(EssayDocument.create(report.text).apply(finding!.proposals[0]!).text).toBe(
            "Tomorrow we will go home.",
        );
    });

    it("adds a final period only to a clear finite statement", () => {
        const report = createPipeline().analyze("We will go home");
        const finding = report.diagnostics.find((item) => item.ruleId === "missing-terminal-mark");

        expect(finding?.goalId).toBe("writing.endmarks");
        expect(EssayDocument.create(report.text).apply(finding!.proposals[0]!).text).toBe(
            "We will go home.",
        );
        expect(createPipeline().analyze("Where are we?").diagnostics).toEqual([]);
        expect(createPipeline().analyze("What we learned").diagnostics).toEqual([]);
    });

    it("respects an intentional lower-case document style", () => {
        const report = createPipeline().analyze("we work. they work. people work.");
        expect(report.sentences).toHaveLength(3);
        expect(report.diagnostics.some((item) => item.ruleId === "sentence-capitalization")).toBe(
            false,
        );
        expect(createPipeline().analyze("we use e.g. examples. they work.").sentences).toHaveLength(
            2,
        );
    });

    it("checks only common unambiguous contraction spellings", () => {
        const report = createPipeline().analyze("Theyre ready, but the cant was confusing.");
        const issue = report.diagnostics.find(
            (item) => item.ruleId === "missing-contraction-apostrophe",
        );

        expect(issue?.goalId).toBe("writing.apostrophe");
        expect(
            report.goalMetadata?.find((goal) => goal.id === "writing.contractions")?.diagnosticIds,
        ).toContain(issue?.id);
        expect(EssayDocument.create(report.text).apply(issue!.proposals[0]!).text).toBe(
            "They're ready, but the cant was confusing.",
        );
    });

    it("keeps spacing observations optional and separate from correctness findings", () => {
        const text = "We saw  birds.";
        expect(
            createPipeline()
                .analyze(text)
                .diagnostics.some((item) => item.ruleId === "repeated-spacing"),
        ).toBe(false);

        const issue = createPipeline()
            .analyze(text, 0, true)
            .diagnostics.find((item) => item.ruleId === "repeated-spacing");
        expect(issue?.goalId).toBe("writing.spacing");
        expect(issue?.category).toBe("Style");
        expect(issue?.proposals).toEqual([]);
    });
});
