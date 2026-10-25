import { describe, expect, it } from "vitest";
import { advancedRules } from "../src/advanced-grammar";
import { rules } from "../src/grammar";
import { detectableGoalIds, goalByRule } from "../src/goal-rules";
import {
    EssayDocument,
    attachGoalMetadata,
    createPipeline,
    documentSchema,
    type Diagnostic,
    writingGoals,
} from "../src";

describe("writing intent and goal metadata", () => {
    it("derives detection coverage only from real rule associations", () => {
        const knownGoals = new Set(writingGoals.map((goal) => goal.id));
        for (const [ruleId, goalIds] of Object.entries(goalByRule)) {
            expect(goalIds.length, ruleId).toBeGreaterThan(0);
            expect(new Set(goalIds).size, ruleId).toBe(goalIds.length);
            for (const goalId of goalIds) expect(knownGoals.has(goalId), ruleId).toBe(true);
        }
        for (const goal of writingGoals) {
            expect(goal.detection, goal.id).toBe(
                detectableGoalIds.has(goal.id) ? "implemented-unvalidated" : "not-yet-detectable",
            );
            expect(goal.detectorIds.length, goal.id).toBeGreaterThan(0);
            for (const detectorId of goal.detectorIds)
                expect(goalByRule[detectorId], `${goal.id} -> ${detectorId}`).toContain(goal.id);
        }
        expect(writingGoals).toHaveLength(100);
        expect(detectableGoalIds.size).toBe(100);
        // These registry entries dispatch multiple concrete rule IDs instead of emitting their own.
        const dispatchers = new Set(["punctuation", "clause-punctuation"]);
        for (const rule of [...rules, ...advancedRules]) {
            if (!dispatchers.has(rule.id)) expect(goalByRule[rule.id], rule.id).toBeDefined();
        }
    });

    it("does not overclaim broad revision from a repeated sentence opening", () => {
        const report = createPipeline().analyze(
            "We can always walk home. We can always read books. We can always share stories.",
            1,
            true,
        );
        const repeated = report.diagnostics.find(
            (diagnostic) => diagnostic.ruleId === "document-repetition",
        );
        expect(repeated?.goalId).toBe("writing.sentence-variety");
        expect(report.goalMetadata?.find((goal) => goal.id === "writing.revision")?.detection).toBe(
            "implemented-unvalidated",
        );
        expect(
            report.goalMetadata?.find((goal) => goal.id === "writing.revision")?.detectorMode,
        ).toBe("evidence-cue");
        expect(
            report.goalMetadata?.find((goal) => goal.id === "writing.revision")?.diagnosticIds,
        ).toEqual([]);
        expect(
            report.goalMetadata?.find((goal) => goal.id === "writing.sentence-variety")
                ?.diagnosticIds,
        ).toContain(repeated?.id);
        for (const goalId of ["writing.editing", "writing.list-punctuation"]) {
            expect(writingGoals.find((goal) => goal.id === goalId)?.detection).toBe(
                "implemented-unvalidated",
            );
        }
    });
    it("loads old document records without an intent and preserves the choice in new records", () => {
        const original = EssayDocument.create("She walk home.", "A draft");
        const legacy = documentSchema.parse({
            ...original.record,
            writingIntent: undefined,
        });
        expect(legacy.writingIntent).toBeUndefined();

        const focused = new EssayDocument(legacy).withWritingIntent("narrative");
        expect(focused.record.writingIntent).toBe("narrative");
        expect(focused.text).toBe(original.text);
        expect(focused.record.revisions).toEqual(original.record.revisions);
        expect(focused.undo().record.writingIntent).toBe("narrative");
    });

    it("rejects unknown intent values while keeping the field optional", () => {
        const original = EssayDocument.create("A complete sentence.").record;
        expect(documentSchema.safeParse({ ...original, writingIntent: "AP-essay" }).success).toBe(
            false,
        );
        expect(documentSchema.safeParse(original).success).toBe(true);
    });

    it("returns the selected intent and traceable, honest goal coverage", () => {
        const report = createPipeline().analyze("She walk home.", 1, false, "narrative");
        expect(report.writingIntent).toBe("narrative");
        expect(report.goalMetadata).toHaveLength(writingGoals.length);
        expect(report.goalMetadata?.every((goal) => !("validated" in goal))).toBe(true);

        const agreement = report.goalMetadata?.find((goal) => goal.id === "writing.agreement");
        expect(agreement?.detection).toBe("implemented-unvalidated");
        expect(agreement?.relevantToIntent).toBe(true);
        expect(agreement?.diagnosticIds.length).toBeGreaterThan(0);
        expect(
            report.diagnostics.find((diagnostic) => diagnostic.ruleId === "agreement")?.goalId,
        ).toBe("writing.agreement");

        const synthesis = report.goalMetadata?.find((goal) => goal.id === "writing.synthesis");
        expect(synthesis?.detection).toBe("implemented-unvalidated");
        expect(synthesis?.detectorMode).toBe("evidence-cue");
        expect(synthesis?.detectorIds).toContain("writing-cue-synthesis");
        expect(synthesis?.diagnosticIds).toEqual([]);
    });

    it("reuses frozen goal metadata for clean drafts without sharing mutable report state", () => {
        const pipeline = createPipeline();
        const first = pipeline.analyze("Clear words. Plain ideas.");
        const second = pipeline.analyze("A different clean draft.");
        expect(first.diagnostics).toEqual([]);
        expect(second.diagnostics).toEqual([]);
        expect(second.goalMetadata).toBe(first.goalMetadata);
        expect(Object.isFrozen(first.goalMetadata)).toBe(true);
        expect(Object.isFrozen(first.goalMetadata?.[0])).toBe(true);
        expect(Object.isFrozen(first.goalMetadata?.[0]?.diagnosticIds)).toBe(true);
    });

    it("links both surfaced run-on rule IDs to the same stable goal", () => {
        const base = createPipeline().analyze("");
        for (const [index, ruleId] of ["run-on", "comma-splice"].entries()) {
            const diagnostic: Diagnostic = {
                start: index,
                end: index + 1,
                id: `${ruleId}:${index}`,
                ruleId,
                category: "Punctuation",
                skill: "boundaries",
                title: "Review a clause boundary",
                explanation: "The two clauses may need a stronger boundary.",
                certainty: "Possible issue",
                evidence: [],
                confidence: { policy: "Fixture only", calibrated: false },
                proposals: [],
            };
            const report = attachGoalMetadata({ ...base, diagnostics: [diagnostic] });
            expect(report.diagnostics[0]?.goalId).toBe("writing.runons");
            expect(
                report.goalMetadata?.find((goal) => goal.id === "writing.runons")?.diagnosticIds,
            ).toEqual([diagnostic.id]);
        }
    });

    it("links every emitted detector rule ID to its learner-facing goal", () => {
        const ruleGoals = [
            ["count-noun-number", "writing.plural"],
            ["agreement", "writing.agreement"],
            ["neural-agreement", "writing.agreement"],
            ["verb-form", "writing.irregular"],
            ["neural-perfect-form", "writing.irregular"],
            ["neural-modal-form", "writing.irregular"],
            ["article-sound", "writing.articles"],
            ["comma-splice", "writing.runons"],
            ["run-on", "writing.runons"],
            ["parsed-boundary", "writing.runons"],
            ["dependent-fragment", "writing.fragments"],
            ["pronoun-case", "writing.pronoun-case"],
            ["pronoun-reference", "writing.pronouns"],
            ["subject-case", "writing.pronoun-case"],
            ["double-comparison", "writing.comparison"],
            ["possessive-apostrophe", "writing.possessive"],
            ["missing-contraction-apostrophe", "writing.apostrophe"],
            ["quotation-punctuation", "writing.quotes"],
            ["spelling", "writing.spelling"],
            ["dictionary-spelling", "writing.spelling"],
            ["contextual-usage", "writing.homophones"],
            ["parallel-forms", "writing.parallelism"],
            ["modifier-attachment", "writing.modifiers"],
            ["document-repetition", "writing.sentence-variety"],
            ["repeated-word", "writing.concision"],
            ["introductory-comma", "writing.introductory-comma"],
            ["introductory-clause-comma", "writing.introductory-comma"],
            ["missing-series-comma", "writing.commas"],
            ["sentence-capitalization", "writing.capitals"],
            ["missing-terminal-mark", "writing.endmarks"],
            ["repeated-spacing", "writing.spacing"],
            ["colon-complement", "writing.colons"],
            ["semicolon-shared-subject", "writing.semicolons"],
            ["document-tense", "writing.tense"],
        ] as const;
        const base = createPipeline().analyze("");
        const diagnostics = ruleGoals.map(([ruleId], index): Diagnostic => ({
            start: index * 2,
            end: index * 2 + 1,
            id: `${ruleId}:${index}`,
            ruleId,
            category: "Grammar",
            skill: "usage",
            title: "Mapped detector",
            explanation: "Fixture verifying goal traceability.",
            certainty: "Possible issue",
            evidence: [],
            confidence: { policy: "Fixture only", calibrated: false },
            proposals: [],
        }));
        const report = attachGoalMetadata({ ...base, diagnostics });

        for (const [index, [, goalId]] of ruleGoals.entries()) {
            expect(report.diagnostics[index]?.goalId).toBe(goalId);
            expect(
                report.goalMetadata?.find((goal) => goal.id === goalId)?.diagnosticIds,
            ).toContain(diagnostics[index]?.id);
            expect(writingGoals.find((goal) => goal.id === goalId)?.detection).toBe(
                "implemented-unvalidated",
            );
        }
    });
});
