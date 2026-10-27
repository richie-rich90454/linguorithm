import { describe, expect, it } from "vitest";
import { buildRealecSpellingCalibration } from "../../../scripts/realec-spelling-audit.mjs";

const document = {
    id: "private-document-id",
    text: "The wurd appears.",
    annotations: [{ type: "Spelling", spans: [[4, 8]] }],
} as const;
const report = {
    text: document.text,
    diagnostics: [
        {
            ruleId: "dictionary-spelling",
            start: 4,
            end: 8,
            proposals: [{ edits: [{ expected: "wurd", replacement: "word" }] }],
        },
    ],
};
const frequency = { word: 500 };
const contextual = {
    smoothing: 0.1,
    unigrams: { the: 100, word: 200, wurd: 0, appears: 50 },
    bigrams: { "the\0word": 90, "word\0appears": 90 },
};

describe("development-only spelling calibration", () => {
    it("bins accepted candidates by distance, EWT frequency, and contextual gain", () => {
        const audit = buildRealecSpellingCalibration(
            "development",
            [document],
            [report],
            frequency,
            contextual,
        );
        expect(audit?.bins).toEqual([
            {
                editDistance: "1",
                candidateFrequency: "200+",
                contextualGain: ">=2.3",
                predictions: 1,
                annotationOverlaps: 1,
            },
        ]);
    });

    it("counts a predicted token once and keeps development output free of text and IDs", () => {
        const duplicate = {
                ...report.diagnostics[0]!,
                proposals: [{ edits: [{ expected: "wurd", replacement: "word" }] }],
            },
            audit = buildRealecSpellingCalibration(
                "development",
                [document],
                [{ ...report, diagnostics: [...report.diagnostics, duplicate] }],
                frequency,
                contextual,
            );
        expect(audit?.bins[0]?.predictions).toBe(1);
        expect(audit?.bins[0]?.annotationOverlaps).toBe(1);
        expect(JSON.stringify(audit)).not.toContain("private-document-id");
        expect(JSON.stringify(audit)).not.toContain("wurd");
        expect(JSON.stringify(audit)).not.toContain("word");
        expect(JSON.stringify(audit)).not.toContain(document.text);
    });

    it("does not create calibration output for the fixed test split", () => {
        expect(
            buildRealecSpellingCalibration("test", [document], [report], frequency, contextual),
        ).toBeUndefined();
    });

    it("returns the same ordered bins regardless of document traversal order", () => {
        const otherDocument = {
                ...document,
                id: "another-private-id",
                text: "The wrod appears.",
                annotations: [],
            },
            otherReport = {
                ...report,
                text: otherDocument.text,
                diagnostics: [
                    {
                        ...report.diagnostics[0]!,
                        start: 4,
                        end: 8,
                        proposals: [{ edits: [{ expected: "wrod", replacement: "word" }] }],
                    },
                ],
            },
            forward = buildRealecSpellingCalibration(
                "development",
                [document, otherDocument],
                [report, otherReport],
                frequency,
                contextual,
            ),
            reverse = buildRealecSpellingCalibration(
                "development",
                [otherDocument, document],
                [otherReport, report],
                frequency,
                contextual,
            );
        expect(reverse).toEqual(forward);
    });
});
