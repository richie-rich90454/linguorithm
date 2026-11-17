import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => {
    const file = join(root, path);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
};
const row = (id, label, target, observed, status, source) => ({
    id,
    label,
    target,
    observed,
    status,
    source,
});
const threshold = (value, target, direction) =>
    !Number.isFinite(value)
        ? "pending"
        : direction === "min"
          ? value >= target
              ? "pass"
              : "fail"
          : value <= target
            ? "pass"
            : "fail";

const evaluation = read("reports/realec-independent-evaluation.json");
const evaluationCounts = evaluation?.evaluation ?? evaluation ?? {};
const controls = read("reports/language-controls.json");
const offline = read("reports/offline-verification.json");
const parity = read("reports/classifier-score-parity.json");
const v2 = read("reports/benchmark-v2-manifest.json");

const rows = [
    row(
        "legacy-precision",
        "Legacy fixed-test precision",
        ">= 15.69% (no regression)",
        evaluationCounts.precision,
        threshold(evaluationCounts.precision, 0.1568627450980392, "min"),
        "reports/realec-independent-evaluation.json",
    ),
    row(
        "legacy-recall",
        "Legacy fixed-test recall",
        ">= 3.19% (no regression)",
        evaluationCounts.recall,
        threshold(evaluationCounts.recall, 0.03186457555389594, "min"),
        "reports/realec-independent-evaluation.json",
    ),
    row(
        "legacy-error",
        "Legacy total token error",
        "<= 7.525% (no regression)",
        evaluationCounts.errorRate,
        threshold(evaluationCounts.errorRate, 0.07524866420057542, "max"),
        "reports/realec-independent-evaluation.json",
    ),
    row(
        "legacy-fpr",
        "Legacy false-positive rate",
        "<= 1.211% (no regression)",
        evaluationCounts.falsePositiveRate,
        threshold(evaluationCounts.falsePositiveRate, 0.012110970285875228, "max"),
        "reports/realec-independent-evaluation.json",
    ),
    row(
        "controls",
        "Valid-English control suite",
        "0 confirmed false positives",
        controls ? `${controls.failed ?? "?"} failed of ${controls.total ?? "?"}` : undefined,
        controls ? (controls.passed ? "pass" : "fail") : "pending",
        "reports/language-controls.json",
    ),
    row(
        "offline",
        "Verifiable offline behaviour",
        "0 external requests; offline reload renders",
        offline ? `${offline.externalRequests?.length ?? "?"} external requests` : undefined,
        offline ? (offline.passed ? "pass" : "fail") : "pending",
        "reports/offline-verification.json",
    ),
    row(
        "parity",
        "Python/browser model parity",
        "max difference <= 0.0001",
        parity?.maximumDifference,
        parity?.status === "passed" ? "pass" : parity ? "fail" : "pending",
        "reports/classifier-score-parity.json",
    ),
    row(
        "v2-splits",
        "Benchmark v2 splits frozen",
        "deduplicated, writer-separated, sealed test",
        v2
            ? `${v2.v2?.test?.documents ?? "?"} test documents; ${v2.nearDuplicates?.droppedDocuments ?? "?"} duplicates dropped`
            : undefined,
        v2 ? "pass" : "pending",
        "reports/benchmark-v2-manifest.json",
    ),
    row(
        "v2-precision",
        "Benchmark v2 precision at emission",
        ">= 60% (Wilson LB >= 55%)",
        undefined,
        "pending",
        "not measured",
    ),
    row(
        "v2-recall",
        "Benchmark v2 objective recall",
        ">= 25%",
        undefined,
        "pending",
        "not measured",
    ),
    row(
        "v2-calibration",
        "Benchmark v2 calibration",
        "ECE <= 0.05",
        undefined,
        "pending",
        "not measured",
    ),
];

const summary = rows.reduce(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { pass: 0, fail: 0, pending: 0 },
);
const report = {
    format: "linguorithm-scorecard-v1",
    generatedAt: new Date().toISOString(),
    summary,
    rows,
};
writeFileSync(join(root, "reports/scorecard.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
    `scorecard: ${summary.pass} pass, ${summary.fail} fail, ${summary.pending} pending -> reports/scorecard.json`,
);
if (process.argv.includes("--check") && summary.fail > 0) process.exitCode = 1;
