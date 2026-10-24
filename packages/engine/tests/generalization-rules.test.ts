import { describe, expect, it } from "vitest";
import { HybridAnalysisPipeline } from "../src/hybrid";
import { createPipeline } from "../src/pipeline";

describe("precision boundaries outside authored examples", () => {
    it.each([
        "However swiftly they moved, the storm caught them.",
        "However difficult the task becomes, we will finish it.",
        "However hard they tried, the latch remained stuck.",
    ])("does not mistake concessive degree for a transition: %s", (text) => {
        expect(
            createPipeline()
                .analyze(text)
                .diagnostics.some((d) => d.ruleId === "introductory-comma"),
        ).toBe(false);
    });

    it("still checks an ordinary introductory transition", () => {
        expect(
            createPipeline()
                .analyze("However the seedlings survived.")
                .diagnostics.some((d) => d.ruleId === "introductory-comma"),
        ).toBe(true);
    });

    it("withholds English corrections when the installed dictionary cannot support the sentence", async () => {
        let classifierCalls = 0;
        const pipeline = new HybridAnalysisPipeline({
            dictionary: ["those", "devices", "are", "ready", "today", "public", "event"],
            lexicon: { frequency: {} },
            metadata: { version: "controlled-boundary", limitations: [] },
            sentence: async (s) => s,
            classify: async () => {
                classifierCalls++;
                return [];
            },
        });
        const unsupported = await pipeline.analyze(
            "Unbekannte fremde Wörter stehen hier nebeneinander.",
        );
        expect(unsupported.diagnostics).toEqual([]);
        expect(
            unsupported.limitations.some((line) =>
                line.includes("insufficient dictionary coverage"),
            ),
        ).toBe(true);
        expect(classifierCalls).toBe(0);
        const supported = await pipeline.analyze("Those devices are ready today.");
        expect(supported.modelStatus?.state).toBe("ready");
        expect(classifierCalls).toBe(1);
    });
});
