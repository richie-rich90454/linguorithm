import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPipeline } from "../packages/engine/src/pipeline";

interface ControlCase {
    id: string;
    label: string;
    text: string;
    note: string;
    dialect?: boolean;
}

const cases = JSON.parse(
    readFileSync("packages/engine/tests/fixtures/language-controls.json", "utf8"),
) as ControlCase[];
const pipeline = createPipeline();
const results = cases.map((item) => {
    const emissions = pipeline.analyze(item.text).diagnostics.map((diagnostic) => ({
        ruleId: diagnostic.ruleId,
        category: diagnostic.category,
        certainty: diagnostic.certainty,
    }));
    const passed = item.dialect
        ? !emissions.some(
              (emission) =>
                  emission.category === "Grammar" && emission.certainty !== "Possible issue",
          )
        : !emissions.some((emission) => emission.certainty === "Confirmed error");
    return {
        id: item.id,
        label: item.label,
        passed,
        emissions,
    };
});
const passed = results.filter((result) => result.passed).length;
const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    cases: results,
    openLimitations: [] as string[],
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/language-controls.json", JSON.stringify(report, null, 4) + "\n");
console.log(
    JSON.stringify({
        path: "reports/language-controls.json",
        total: report.total,
        passed,
        failed: report.failed,
    }),
);
if (report.failed) process.exitCode = 1;
