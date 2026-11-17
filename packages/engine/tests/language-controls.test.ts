import { describe, expect, it } from "vitest";
import cases from "./fixtures/language-controls.json";
import { createPipeline } from "../src/pipeline";

interface ControlCase {
    id: string;
    label: string;
    text: string;
    note: string;
    dialect?: boolean;
}

const controls = cases as ControlCase[];

describe("valid-English language controls", () => {
    it("contains at least 80 uniquely identified, fully described cases", () => {
        expect(controls.length).toBeGreaterThanOrEqual(80);
        expect(new Set(controls.map((item) => item.id)).size).toBe(controls.length);
        for (const item of controls) {
            expect(item.id.trim(), "id").not.toBe("");
            expect(item.label.trim(), `label for ${item.id}`).not.toBe("");
            expect(item.text.trim(), `text for ${item.id}`).not.toBe("");
            expect(item.note.trim(), `note for ${item.id}`).not.toBe("");
        }
    });

    it("never confirms a valid-English control as an error", () => {
        const pipeline = createPipeline();
        const failures: string[] = [];
        for (const item of controls) {
            const report = pipeline.analyze(item.text);
            for (const diagnostic of report.diagnostics) {
                if (diagnostic.certainty !== "Confirmed error") continue;
                failures.push(
                    `${item.id} | ${diagnostic.ruleId} | ${diagnostic.category} | ${item.text}`,
                );
            }
        }
        expect(failures).toEqual([]);
    });

    it("does not raise any grammar diagnostic for dialect controls", () => {
        const pipeline = createPipeline();
        const failures: string[] = [];
        for (const item of controls) {
            if (!item.dialect) continue;
            for (const diagnostic of pipeline.analyze(item.text).diagnostics) {
                if (diagnostic.category !== "Grammar" || diagnostic.certainty === "Possible issue")
                    continue;
                failures.push(
                    `${item.id} | ${diagnostic.ruleId} | ${diagnostic.certainty} | ${item.text}`,
                );
            }
        }
        expect(failures).toEqual([]);
    });
});
