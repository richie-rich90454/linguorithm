import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    annotatedCorpusSchema,
    annotationAgreement,
    annotationCategorySchema,
    compareSystems,
    parseSupportedPatternDeclarations,
    requireSupportedPatternDeclarations,
    type ComparisonOptions,
} from "../packages/engine/src/annotations";

const help = `Compare frozen, supplied predictions against independently annotated source text.

PowerShell (all tools remain inside this project):
  make compare ARGS="--corpus path/to/gold.json --run path/to/system-a.json --run path/to/system-b.json --out reports/comparison.json"

Options:
  --corpus PATH          Required grammar-annotations JSON corpus.
  --run PATH             Required grammar-predictions JSON; repeat for comparisons/ablations.
  --out PATH             Output JSON (default reports/comparison.json).
  --annotations PATH     Optional JSON array of independent annotator submissions.
  --split NAME           train, validation, or test (default test).
  --supported LIST       Comma-separated predeclared categories; default none.
  --supported-patterns LIST  Comma-separated Category=subtype=direct|review declarations.
  --top-k N              Acceptable-correction rank cutoff (default 3).
  --confidence N         High-confidence cutoff (default 0.95).
  --bootstrap N          Group-bootstrap replicates, 50..10000 (default 1000).
  --seed N               Unsigned 32-bit reproducibility seed (default 20261022).
  --require-gates        Exit 1 unless every declared pattern passes for every run.
  --help                Print usage.

Gold schemas and JSON examples: docs/evaluation-protocol.md.
No systems, competitor services, or network APIs are invoked. No reference labels are inferred.
Exit codes: 0 evaluated; 1 declared release gate failed; 2 invalid/unreviewed/leaking input.
`;

export function runComparisonCli(args: string[]): number {
    if (args.includes("--help")) {
        console.log(help);
        return 0;
    }
    const values = new Map<string, string[]>();
    let requireGates = false;
    const names = new Set([
        "--corpus",
        "--run",
        "--out",
        "--annotations",
        "--split",
        "--supported",
        "--supported-patterns",
        "--top-k",
        "--confidence",
        "--bootstrap",
        "--seed",
    ]);
    try {
        for (let i = 0; i < args.length; i++) {
            const name = args[i]!;
            if (name === "--require-gates") {
                requireGates = true;
                continue;
            }
            if (!names.has(name)) throw new Error(`Unknown option: ${name}`);
            const value = args[++i];
            if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
            if (name !== "--run" && values.has(name)) throw new Error(`Repeated option: ${name}`);
            values.set(name, [...(values.get(name) ?? []), value]);
        }
        const one = (name: string) => values.get(name)?.[0];
        const corpusPath = one("--corpus"),
            runPaths = values.get("--run");
        if (!corpusPath || !runPaths?.length)
            throw new Error("--corpus and at least one --run are required. Use --help for usage.");
        const json = (path: string): unknown => JSON.parse(readFileSync(resolve(path), "utf8"));
        const corpus = annotatedCorpusSchema.parse(json(corpusPath));
        const options: ComparisonOptions = {};
        const split = one("--split");
        if (split && split !== "train" && split !== "validation" && split !== "test")
            throw new Error("Unknown split.");
        if (split) options.split = split;
        const numericOptions = [
            ["--top-k", "topK"],
            ["--confidence", "highConfidence"],
            ["--bootstrap", "bootstrapSamples"],
            ["--seed", "seed"],
        ] as const;
        for (const [name, property] of numericOptions) {
            const value = one(name);
            if (value !== undefined) {
                const parsed = Number(value);
                if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${name}`);
                options[property] = parsed;
            }
        }
        if (
            options.seed !== undefined &&
            (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff)
        )
            throw new Error("Seed must be an unsigned 32-bit integer.");
        if (one("--supported"))
            options.supportedCategories = one("--supported")!
                .split(",")
                .map((c) => annotationCategorySchema.parse(c.trim()));
        if (one("--supported-patterns"))
            options.supportedPatterns = parseSupportedPatternDeclarations(
                one("--supported-patterns")!,
            );
        requireSupportedPatternDeclarations(requireGates, options.supportedPatterns);
        const comparison = compareSystems(corpus, runPaths.map(json), options);
        const annotationPath = one("--annotations");
        const report = {
            ...comparison,
            annotationReview: annotationPath
                ? annotationAgreement(corpus, json(annotationPath))
                : null,
            execution: {
                node: process.version,
                platform: process.platform,
                architecture: process.arch,
            },
        };
        const output = resolve(one("--out") ?? "reports/comparison.json");
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, JSON.stringify(report, null, 4) + "\n", "utf8");
        const failed = report.systems.flatMap((system) =>
            system.metrics
                .filter((metric) => metric.releaseGate.status === "failed")
                .map((metric) => `${system.id}/${metric.key}`),
        );
        console.log(
            JSON.stringify(
                {
                    output,
                    documents: report.corpus.documents,
                    independentGroups: report.corpus.independentGroups,
                    systems: report.systems.map((s) => s.id),
                    failedMetrics: failed,
                    annotationReview: annotationPath ? "included" : "not supplied",
                },
                null,
                2,
            ),
        );
        return requireGates && failed.length ? 1 : 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    process.exitCode = runComparisonCli(process.argv.slice(2));
