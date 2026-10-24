import { describe, expect, it } from "vitest";
import { writingGoalById, writingGoals } from "../src/goals";

describe("general writing goal catalog", () => {
    it("provides a stable, traceable progression with complete learner-facing fields", () => {
        expect(writingGoals.length).toBeGreaterThan(70);
        expect(
            writingGoals.every((goal) => !["validated", "completed"].includes(goal.detection)),
        ).toBe(true);
        expect(new Set(writingGoals.map((goal) => goal.id)).size).toBe(writingGoals.length);
        for (const goal of writingGoals) {
            expect(goal.id).toMatch(/^writing\.[a-z]+(?:-[a-z]+)*$/);
            expect(goal.name.trim()).not.toBe("");
            expect(goal.description.trim()).not.toBe("");
            expect(goal.example.trim()).not.toBe("");
            expect(goal.validControls.length).toBeGreaterThan(0);
            expect(goal.ageOrProficiency.trim()).not.toBe("");
            expect(goal.curriculumReferences.length).toBeGreaterThan(0);
            expect(goal.intents.length).toBeGreaterThan(0);
            expect(goal.correctionPolicy.trim()).not.toBe("");
            if (goal.detection === "implemented-unvalidated")
                expect(goal.correctionPolicy).toContain("never edit automatically");
            else expect(goal.correctionPolicy).toContain("No local detector is available");
            expect(["learner-choice", "sentence-level", "text-level", "conventions"]).toContain(
                goal.control,
            );
            if (goal.practiceLink) {
                expect(goal.skill).toBeDefined();
                expect(goal.practiceLink).toBe(`/practice/${goal.skill}`);
            } else {
                expect(goal.skill).toBeUndefined();
                expect(goal.practiceLink).toBeUndefined();
            }
        }
    });

    it("keeps early goals writing-focused and exposes the actual detector boundary", () => {
        const early = writingGoals.filter((goal) => goal.band === "emergent");
        expect(early.length).toBeGreaterThan(0);
        expect(early.every((goal) => goal.intents.every((intent) => intent !== "analytical"))).toBe(
            true,
        );
        expect(early.every((goal) => goal.detection === "not-yet-detectable")).toBe(true);
        expect(writingGoalById("writing.agreement")?.skill).toBe("agreement");
        expect(writingGoalById("writing.agreement")?.detection).toBe("implemented-unvalidated");
        expect(writingGoalById("writing.sentence")?.detection).toBe("not-yet-detectable");
        expect(writingGoalById("writing.boundaries")?.detection).toBe("not-yet-detectable");
        expect(writingGoalById("writing.synthesis")?.detection).toBe("not-yet-detectable");
        expect(writingGoalById("writing.ap")).toBeUndefined();
        expect(writingGoalById("writing.capitalnames")?.detection).toBe("not-yet-detectable");
        expect(writingGoalById("writing.capitals")?.detection).toBe("not-yet-detectable");
        expect(writingGoalById("writing.conditionals")).toBeDefined();
        expect(writingGoalById("writing.gerunds")).toBeDefined();
        expect(writingGoalById("writing.appositives")).toBeDefined();
        expect(writingGoalById("writing.semicolons")).toBeDefined();
        expect(writingGoalById("writing.semicolons")?.detection).toBe("implemented-unvalidated");
        expect(writingGoalById("writing.colons")?.detection).toBe("implemented-unvalidated");
        expect(writingGoalById("writing.commentary")).toBeDefined();
        expect(writingGoalById("writing.runons")?.skill).toBe("boundaries");
        for (const id of [
            "writing.reported-tense",
            "writing.infinitives",
            "writing.restrictive-clauses",
            "writing.nonrestrictive-clauses",
            "writing.colons",
            "writing.list-punctuation",
            "writing.paragraph-focus",
            "writing.tone-consistency",
            "writing.evidence-relevance",
            "writing.rhetorical-situation",
        ])
            expect(writingGoalById(id)).toBeDefined();
    });
});
