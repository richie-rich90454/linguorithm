import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, extname, resolve, sep } from "node:path";
import { createServer } from "vite";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const generated = resolve("models/generated/ewt-1");
const scoresMode = process.argv.includes("--scores");
const fixturePath = resolve(
    generated,
    scoresMode ? "classifier-scores-parity.json" : "classifier-feature-parity.json",
);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportPath = resolve(
    scoresMode ? "reports/classifier-score-parity.json" : "reports/classifier-feature-parity.json",
);
const report = {
    status: "failed",
    [scoresMode ? "scoreFixtureSha256" : "featureFixtureSha256"]: sha256(fixtureBytes),
    ...(scoresMode ? { weightSha256: fixture.weightSha256, tolerance: 0.0001 } : {}),
    modelHashes: fixture.hashes,
    fixtures: scoresMode ? (fixture.inputs?.words?.length ?? 0) : (fixture.fixtures?.length ?? 0),
    checkedTokens: 0,
    method: scoresMode
        ? "New classifier Python ONNX versus actual browser WASM inference on held-out feature tensors"
        : "Actual browser LocalSyntaxRuntime tokenizer, tagger, parser and classify input tensors; frozen Python feature comparison",
};
let server;
let browser;
try {
    if (
        fixture.schemaVersion !== 1 ||
        (scoresMode ? !fixture.inputs?.words?.length : !fixture.fixtures?.length)
    )
        throw new Error("Missing prepared classifier feature fixtures.");
    const assetRoot = resolve(".cache/classifier-feature-assets");
    const modelRoot = resolve(assetRoot, "models");
    mkdirSync(assetRoot, { recursive: true });
    const restored = spawnSync(process.execPath, [resolve("scripts/restore-models.mjs")], {
        env: { ...process.env, SYNTAX_MODEL_SOURCE: "release", SYNTAX_MODEL_OUTPUT: modelRoot },
        stdio: "inherit",
        shell: false,
    });
    if (restored.error || restored.status !== 0)
        throw new Error("Could not restore the contained feature-validation runtime.");
    for (const [name, hash] of Object.entries(fixture.hashes)) {
        if (
            ![
                "tagger.onnx",
                "parser.onnx",
                "lexicon.json",
                "tagger-manifest.json",
                "parser-manifest.json",
            ].includes(name)
        )
            throw new Error("Unexpected frozen feature resource.");
        const source = resolve(generated, name);
        const bytes = readFileSync(source);
        if (sha256(bytes) !== hash) throw new Error(`Prepared feature resource changed: ${name}`);
        writeFileSync(resolve(modelRoot, name.endsWith(".onnx") ? `weights/${name}` : name), bytes);
    }
    const registry = JSON.parse(readFileSync(resolve(modelRoot, "registry.json"), "utf8"));
    for (const task of ["tagger", "parser"]) {
        const name = `${task}-manifest.json`;
        const bytes = readFileSync(resolve(generated, name));
        if (sha256(bytes) !== fixture.hashes[name])
            throw new Error(`Prepared feature manifest changed: ${name}`);
        const metadata = JSON.parse(bytes.toString("utf8"));
        if (metadata.sha256 !== fixture.hashes[`${task}.onnx`])
            throw new Error(`Manifest does not identify the prepared ${task} weights.`);
        writeFileSync(resolve(modelRoot, name), bytes);
        registry[task] = { path: name, sha256: sha256(bytes) };
    }
    registry.lexicon = { path: "lexicon.json", sha256: fixture.hashes["lexicon.json"] };
    if (scoresMode) {
        const weights = readFileSync(resolve(generated, "error-classifier.onnx"));
        const metadataBytes = readFileSync(resolve(generated, "classifier-manifest.json"));
        const metadata = JSON.parse(metadataBytes.toString("utf8"));
        if (
            sha256(weights) !== fixture.weightSha256 ||
            metadata.sha256 !== fixture.weightSha256 ||
            JSON.stringify(metadata.labels) !== JSON.stringify(fixture.labels)
        )
            throw new Error("New classifier weights, labels, manifest and score fixture disagree.");
        writeFileSync(resolve(modelRoot, "weights/error-classifier.onnx"), weights);
        writeFileSync(resolve(modelRoot, "classifier-manifest.json"), metadataBytes);
        registry.classifier = { path: "classifier-manifest.json", sha256: sha256(metadataBytes) };
    }
    writeFileSync(resolve(modelRoot, "registry.json"), JSON.stringify(registry));
    server = await createServer({
        configFile: resolve("apps/web/vite.config.ts"),
        root: resolve("apps/web"),
        base: "/",
        server: { host: "127.0.0.1", port: 4319, strictPort: true },
        plugins: [
            {
                name: "classifier-feature-fixture-assets",
                configureServer(instance) {
                    instance.middlewares.use((request, response, next) => {
                        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
                        if (pathname === "/__feature-check") {
                            response.setHeader("Content-Type", "text/html; charset=utf-8");
                            response.end(
                                "<!doctype html><html><head><title>Classifier feature parity</title></head><body>Local model validation</body></html>",
                            );
                            return;
                        }
                        if (!pathname.startsWith("/__feature-models/")) return next();
                        try {
                            const relative = decodeURIComponent(
                                pathname.slice("/__feature-models/".length),
                            );
                            if (
                                !/^models\/[A-Za-z0-9_./-]+$/u.test(relative) ||
                                relative
                                    .split("/")
                                    .some((part) => !part || part === "." || part === "..")
                            )
                                throw new Error("Invalid asset path.");
                            const path = resolve(assetRoot, relative);
                            if (!path.startsWith(assetRoot + sep) || !statSync(path).isFile())
                                throw new Error("Asset path escapes validation resources.");
                            const mime = {
                                ".json": "application/json",
                                ".js": "text/javascript",
                                ".mjs": "text/javascript",
                                ".wasm": "application/wasm",
                                ".onnx": "application/octet-stream",
                            }[extname(path)];
                            if (!mime) throw new Error("Unsupported validation asset type.");
                            response.setHeader("Content-Type", mime);
                            response.setHeader("Cache-Control", "no-store");
                            response.end(readFileSync(path));
                        } catch {
                            response.statusCode = 404;
                            response.end("Validation asset unavailable.");
                        }
                    });
                },
            },
        ],
    });
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:4319/__feature-check");
    const result = await page.evaluate(
        async ({ fixtures, scores, scoresMode }) => {
            const { LocalSyntaxRuntime } = await import("/src/local-syntax.ts");
            const runtime = await LocalSyntaxRuntime.load(location.origin + "/__feature-models/");
            const original = runtime.classifier;
            if (!original || !runtime.classifierMetadata)
                throw new Error("Classifier feature capture unavailable.");
            if (scoresMode) {
                try {
                    const inputs = scores.inputs,
                        n = inputs.words.length,
                        k = scores.labels.length;
                    if (
                        n !== 20 ||
                        inputs.tags.length !== n ||
                        inputs.features.length !== n ||
                        scores.scores.length !== n ||
                        inputs.words.some(
                            (row) =>
                                row.length !== 7 ||
                                row.some((v) => !Number.isSafeInteger(v) || v < 0),
                        ) ||
                        inputs.tags.some(
                            (row) =>
                                row.length !== 7 ||
                                row.some((v) => !Number.isSafeInteger(v) || v < 0),
                        ) ||
                        inputs.features.some(
                            (row) => row.length !== 6 || row.some((v) => !Number.isFinite(v)),
                        ) ||
                        scores.scores.some(
                            (row) => row.length !== k || row.some((v) => !Number.isFinite(v)),
                        )
                    )
                        throw new Error(
                            "Classifier score fixture dimensions or values are invalid.",
                        );
                    const output = await original.run({
                        words: new runtime.ort.Tensor(
                            "int64",
                            BigInt64Array.from(inputs.words.flat(), BigInt),
                            [n, 7],
                        ),
                        tags: new runtime.ort.Tensor(
                            "int64",
                            BigInt64Array.from(inputs.tags.flat(), BigInt),
                            [n, 7],
                        ),
                        features: new runtime.ort.Tensor(
                            "float32",
                            Float32Array.from(inputs.features.flat()),
                            [n, 6],
                        ),
                    });
                    if (!output.scores || output.scores.dims.join(",") !== `${n},${k}`)
                        throw new Error(
                            "Actual browser classifier output violates its score dimensions.",
                        );
                    const actual = Array.from(output.scores.data, Number),
                        expected = scores.scores.flat();
                    if (
                        actual.length !== expected.length ||
                        actual.some((value) => !Number.isFinite(value))
                    )
                        throw new Error(
                            "Actual browser classifier returned nonfinite or missing scores.",
                        );
                    const maximumDifference = Math.max(
                        ...actual.map((value, i) => Math.abs(value - expected[i])),
                    );
                    if (maximumDifference > 0.0001)
                        throw new Error(
                            `Classifier browser score parity failed: ${maximumDifference}.`,
                        );
                    return { checkedTokens: n, maximumDifference };
                } finally {
                    await runtime.dispose();
                }
            }
            let captured;
            runtime.classifier = {
                async run(inputs) {
                    captured = {
                        words: Array.from(inputs.words.data, Number),
                        tags: Array.from(inputs.tags.data, Number),
                        numeric: Array.from(inputs.features.data, Number),
                    };
                    // Capturing inputs needs no classifier prediction; syntax inference remains real.
                    return {
                        scores: {
                            data: new Float32Array(
                                inputs.words.dims[0] * runtime.classifierMetadata.labels.length,
                            ),
                        },
                    };
                },
            };
            let checkedTokens = 0;
            try {
                for (const [index, expected] of fixtures.entries()) {
                    const sentence = await runtime.sentence({
                        id: `parity:${index}`,
                        text: expected.text,
                        start: 0,
                        end: expected.text.length,
                        tokens: [],
                        graph: [],
                        ambiguous: true,
                    });
                    if (
                        JSON.stringify(sentence.tokens.map((token) => token.text)) !==
                        JSON.stringify(expected.tokens)
                    )
                        throw new Error(`Fixture ${index}: tokenizer differs.`);
                    if (
                        JSON.stringify(sentence.tokens.map((token) => token.pos)) !==
                        JSON.stringify(expected.tags)
                    )
                        throw new Error(`Fixture ${index}: predicted POS differs.`);
                    captured = undefined;
                    await runtime.classify(sentence);
                    if (!captured)
                        throw new Error(`Fixture ${index}: no actual classifier input captured.`);
                    for (const name of ["words", "tags", "numeric"]) {
                        const values = expected.features.flatMap((token) => token[name]);
                        const actual = captured[name];
                        if (
                            actual.length !== values.length ||
                            values.some((value, i) => value !== actual[i])
                        )
                            throw new Error(
                                `Fixture ${index}: ${name} tensor differs at ${values.findIndex((value, i) => value !== actual[i])}.`,
                            );
                    }
                    checkedTokens += expected.tokens.length;
                }
            } finally {
                runtime.classifier = original;
                await runtime.dispose();
            }
            return { checkedTokens };
        },
        { fixtures: fixture.fixtures, scores: scoresMode ? fixture : null, scoresMode },
    );
    report.checkedTokens = result.checkedTokens;
    if (scoresMode) report.maximumDifference = result.maximumDifference;
    report.status = "passed";
} catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
} finally {
    await browser?.close();
    await server?.close();
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 4) + "\n");
    console.log(JSON.stringify(report, null, 2));
}
