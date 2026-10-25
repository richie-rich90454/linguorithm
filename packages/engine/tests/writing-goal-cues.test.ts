import { describe, expect, it } from "vitest";
import { createPipeline, writingGoals } from "../src";
import { goalByRule } from "../src/goal-rules";
import { writingGoalCueRules } from "../src/writing-goal-cues";

describe("evidence-linked writing goal cues", () => {
    it("connects every catalog goal to at least one implemented rule", () => {
        expect(writingGoals).toHaveLength(100);
        expect(new Set(writingGoals.map((goal) => goal.id)).size).toBe(100);
        expect(writingGoals.every((goal) => goal.detection === "implemented-unvalidated")).toBe(
            true,
        );
        for (const goal of writingGoals) {
            expect(goal.detectorIds.length, goal.id).toBeGreaterThan(0);
            for (const ruleId of goal.detectorIds)
                expect(goalByRule[ruleId], ruleId).toContain(goal.id);
        }
    });

    it("runs each evidence cue on a distinct fixture and returns source-linked review only", () => {
        const pipeline = createPipeline();
        const cueGoalIds = new Set(writingGoalCueRules.map((rule) => rule.goalId));
        expect(cueGoalIds.size).toBe(writingGoalCueRules.length);
        for (const rule of writingGoalCueRules) {
            const writingIntent = rule.goalId === "writing.purpose" ? "explanatory" : "general";
            const base = pipeline.analyze(rule.fixture, 1, false, writingIntent);
            const span = rule.detect({
                text: rule.fixture,
                sentences: base.sentences,
                writingIntent,
            });
            expect(span, rule.goalId).toBeDefined();
            expect(rule.fixture.slice(span!.start, span!.end).length, rule.goalId).toBeGreaterThan(
                0,
            );
            expect(goalByRule[rule.id]).toContain(rule.goalId);
        }
    });

    it("keeps reflection cues optional, bounded, and free of correction edits", () => {
        const pipeline = createPipeline();
        const text =
            "According to the report, traffic fell. The survey found longer waits.\n\nYou can review both sources.";
        const off = pipeline.analyze(text, 1, false, "informative");
        expect(off.diagnostics.some((finding) => finding.ruleId.startsWith("writing-cue-"))).toBe(
            false,
        );

        const on = pipeline.analyze(text, 2, true, "informative");
        const cues = on.diagnostics.filter((finding) => finding.ruleId.startsWith("writing-cue-"));
        expect(cues.length).toBeLessThanOrEqual(8);
        expect(cues.length).toBeGreaterThan(0);
        expect(cues.every((finding) => finding.proposals.length === 0)).toBe(true);
        expect(cues.every((finding) => finding.evidence.length > 0)).toBe(true);
        for (const finding of cues) {
            const metadata = on.goalMetadata?.find((goal) => goal.id === finding.goalId);
            expect(metadata?.detectorIds).toContain(finding.ruleId);
            expect(metadata?.diagnosticIds).toContain(finding.id);
        }

        const oneSentence = pipeline.analyze("The survey may suggest a change.", 3, true);
        expect(
            oneSentence.diagnostics.filter((finding) => finding.ruleId.startsWith("writing-cue-")),
        ).toHaveLength(1);
    });

    it("uses supplied intent only for purpose reflection and ignores cues inside code", () => {
        const purpose = writingGoalCueRules.find((rule) => rule.goalId === "writing.purpose")!;
        expect(
            purpose.detect({ text: purpose.fixture, sentences: [], writingIntent: "general" }),
        ).toBe(undefined);
        expect(
            purpose.detect({ text: purpose.fixture, sentences: [], writingIntent: "explanatory" }),
        ).toBeDefined();

        const pipeline = createPipeline();
        const code = "`if the survey suggests this`";
        const report = pipeline.analyze(code, 1, false);
        const citationCue = writingGoalCueRules.find((rule) => rule.goalId === "writing.sources")!;
        expect(
            citationCue.detect({
                text: code,
                sentences: report.sentences,
                writingIntent: "general",
            }),
        ).toBeUndefined();

        const mixed =
            "`according to` came from a code sample. According to the report, traffic fell.";
        const mixedReport = pipeline.analyze(mixed, 2, false);
        const sourceCue = citationCue.detect({
            text: mixed,
            sentences: mixedReport.sentences,
            writingIntent: "general",
        });
        expect(sourceCue).toBeDefined();
        expect(mixed.slice(sourceCue!.start, sourceCue!.end)).toBe("According to");

        const messageCue = writingGoalCueRules.find((rule) => rule.goalId === "writing.message")!;
        const messageText = "`A cat purrs.` Then birds fly.";
        const messageReport = pipeline.analyze(messageText, 3, false);
        const messageSpan = messageCue.detect({
            text: messageText,
            sentences: messageReport.sentences,
            writingIntent: "general",
        });
        expect(messageSpan).toBeDefined();
        expect(messageText.slice(messageSpan!.start, messageSpan!.end)).toBe("Then");

        const compoundCue = writingGoalCueRules.find((rule) => rule.goalId === "writing.compound")!;
        const compoundText = "`Birds fly, and fish swim.` Birds fly, and fish swim.";
        const compoundReport = pipeline.analyze(compoundText, 4, false);
        const compoundSpan = compoundCue.detect({
            text: compoundText,
            sentences: compoundReport.sentences,
            writingIntent: "general",
        });
        expect(compoundSpan).toBeDefined();
        expect(compoundText.slice(compoundSpan!.start, compoundSpan!.end)).toBe("and");
        expect(compoundSpan!.start).toBeGreaterThan(compoundText.lastIndexOf("`"));
    });

    it("requires separate claim-like and evidence-like cues for evidence relevance", () => {
        const evidenceCue = writingGoalCueRules.find(
            (rule) => rule.goalId === "writing.evidence-relevance",
        )!;
        const pipeline = createPipeline();
        const onlyEvidence = "The survey arrived today.";
        const onlyEvidenceReport = pipeline.analyze(onlyEvidence);
        expect(
            evidenceCue.detect({
                text: onlyEvidence,
                sentences: onlyEvidenceReport.sentences,
                writingIntent: "general",
            }),
        ).toBeUndefined();

        const onlyClaim = "The claim is clear.";
        const onlyClaimReport = pipeline.analyze(onlyClaim);
        expect(
            evidenceCue.detect({
                text: onlyClaim,
                sentences: onlyClaimReport.sentences,
                writingIntent: "general",
            }),
        ).toBeUndefined();

        const both = "The survey supports the claim.";
        const bothReport = pipeline.analyze(both);
        expect(
            evidenceCue.detect({
                text: both,
                sentences: bothReport.sentences,
                writingIntent: "general",
            }),
        ).toBeDefined();
    });
});
