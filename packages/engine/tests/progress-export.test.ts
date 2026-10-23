import { expect, it } from "vitest";
import { ProgressExporter, type Attempt } from "../src";

it("exports complete attempt evidence while neutralizing spreadsheet formulas", () => {
    const attempt: Attempt = {
        id: "=formula()",
        exerciseId: 'quoted,"question"',
        skill: "agreement",
        correct: true,
        answer: 0,
        hints: 0,
        at: "2026-01-01T00:00:00Z",
        attemptNumber: 1,
        difficulty: 2,
        durationMs: 1234,
        phase: "practice",
    };
    const csv = new ProgressExporter().csv([attempt]);
    expect(csv).toContain('"\'=formula()"');
    expect(csv).toContain('"quoted,""question"""');
    expect(csv).toContain('"difficulty","durationMs"');
    expect(csv).toContain('"1","2","1234"');
});
