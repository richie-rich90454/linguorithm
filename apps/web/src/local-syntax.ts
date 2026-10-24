import { z } from "zod";
import {
    MorphologyAnalyzer,
    Tokenizer,
    finding,
    viterbi,
    type ContextualTables,
    type Diagnostic,
    type Dependency,
    type Morphology,
    type Pos,
    type Sentence,
    type Token,
} from "@grammar/engine";

const pos = z.enum([
    "ADJ",
    "ADP",
    "ADV",
    "AUX",
    "CCONJ",
    "DET",
    "INTJ",
    "NOUN",
    "NUM",
    "PART",
    "PRON",
    "PROPN",
    "PUNCT",
    "SCONJ",
    "SYM",
    "VERB",
    "X",
]);
const metadataSchema = z.object({
    version: z.string(),
    task: z.enum(["pos", "parser"]),
    artifact: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    vocabulary: z.record(z.string(), z.number().int().nonnegative()),
    characters: z.record(z.string(), z.number().int().nonnegative()),
    tags: z.array(pos),
    transitions: z.array(z.array(z.number().finite())),
    startScores: z.array(z.number().finite()),
    endScores: z.array(z.number().finite()),
    actions: z.array(z.string()).optional(),
    evaluation: z.record(z.string(), z.unknown()),
    limitations: z.array(z.string()),
    provenance: z.array(z.record(z.string(), z.unknown())).min(1),
});
const resource = z.object({
    path: z.string().regex(/^[a-zA-Z0-9_./-]+$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const registrySchema = z.object({
    schemaVersion: z.literal(2),
    version: z.string(),
    tagger: resource,
    parser: resource,
    lexicon: resource,
    contextual: resource.optional(),
    classifier: resource.optional(),
    dictionary: resource.optional(),
    policy: z.string(),
});
const classifierSchema = z.object({
    artifact: z.string(),
    sha256: z.string(),
    labels: z.array(z.string()),
    calibration: z.record(
        z.string(),
        z.object({
            available: z.boolean(),
            a: z.number().optional(),
            b: z.number().optional(),
            threshold: z.number().optional(),
            scope: z.string().optional(),
            releaseGate: z.boolean().optional(),
        }),
    ),
});
type Metadata = z.infer<typeof metadataSchema>;
type Ort = typeof import("onnxruntime-web/wasm");
type State = {
    stack: number[];
    pointer: number;
    heads: number[];
    relations: string[];
    left: number[];
    right: number[];
    score: number;
};
export async function verifiedResource(
    base: URL,
    path: string,
    hash: string,
): Promise<ArrayBuffer> {
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
        throw new Error("Model resource must stay within the local asset directory.");
    // Bind the cache key to the verified content, including when a deployment reuses filenames.
    url.searchParams.set("sha256", hash);
    // Only verified bytes enter this cache. Service-worker response caching happens before
    // application integrity checks and would otherwise retain a corrupted download indefinitely.
    const cache = await caches.open("syntax-verified-models-v3").catch(() => undefined);
    const cached = await cache?.match(url).catch(() => undefined);
    const response = cached ?? (await fetch(url, { credentials: "omit" }));
    if (!response.ok || Number(response.headers.get("content-length")) > 100_000_000)
        throw new Error(`Local model asset unavailable or too large: ${path}`);
    if (!response.body) throw new Error("Model resource has no response body.");
    const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > 100_000_000) {
                await reader.cancel();
                throw new Error("Model resource is too large.");
            }
            chunks.push(next.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const data = bytes.buffer;
    const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    if (actual !== hash) {
        await cache?.delete(url).catch(() => false);
        throw new Error(`Integrity check failed for ${path}.`);
    }
    if (!cached) {
        // Storage denial/quota must not prevent online analysis.
        await (async () => {
            if (!cache) return;
            await cache.put(url, new Response(data));
            const keys = await cache.keys();
            await Promise.all(
                keys.slice(0, Math.max(0, keys.length - 64)).map((key) => cache.delete(key)),
            );
        })().catch(() => undefined);
    }
    return data;
}
export class LocalSyntaxRuntime {
    private readonly tokenizer: Tokenizer;
    dictionary?: readonly string[];
    contextual?: ContextualTables;
    private classifier?: import("onnxruntime-web").InferenceSession;
    private classifierMetadata?: z.infer<typeof classifierSchema>;
    private constructor(
        private readonly ort: Ort,
        private readonly tagger: import("onnxruntime-web").InferenceSession,
        private readonly parser: import("onnxruntime-web").InferenceSession,
        readonly metadata: Metadata,
        readonly parserMetadata: Metadata,
        readonly lexicon: {
            forms: Record<string, Morphology[]>;
            frequency: Record<string, number>;
        },
    ) {
        this.tokenizer = new Tokenizer(
            new MorphologyAnalyzer(lexicon.forms),
            new Set(Object.keys(metadata.vocabulary)),
        );
    }
    static async load(assetBase: string): Promise<LocalSyntaxRuntime> {
        const base = new URL("models/", assetBase);
        if (base.origin !== self.location.origin)
            throw new Error("Models must be served by this application.");
        const response = await fetch(new URL("registry.json", base), {
            credentials: "omit",
            cache: "no-cache",
        });
        if (!response.ok) throw new Error("No local model registry is installed.");
        const registry = registrySchema.parse(await response.json());
        const resources = await Promise.all(
            [registry.tagger, registry.parser, registry.lexicon].map((r) =>
                verifiedResource(base, r.path, r.sha256),
            ),
        );
        const json = (b: ArrayBuffer): unknown => JSON.parse(new TextDecoder().decode(b));
        const metadata = metadataSchema.parse(json(resources[0]!)),
            parserMetadata = metadataSchema.parse(json(resources[1]!));
        if (
            metadata.task !== "pos" ||
            parserMetadata.task !== "parser" ||
            !parserMetadata.actions?.length ||
            metadata.tags.length > 100
        )
            throw new Error("Model task/schema mismatch.");
        for (const model of [metadata, parserMetadata]) {
            const k = model.tags.length;
            if (
                model.version !== registry.version ||
                new Set(model.tags).size !== k ||
                model.transitions.length !== k ||
                model.transitions.some((row) => row.length !== k) ||
                model.startScores.length !== k ||
                model.endScores.length !== k
            )
                throw new Error("Incompatible model version or CRF dimensions.");
        }
        if (
            JSON.stringify(metadata.vocabulary) !== JSON.stringify(parserMetadata.vocabulary) ||
            metadata.tags.join("\0") !== parserMetadata.tags.join("\0") ||
            parserMetadata.actions?.some(
                (action) => !/^(?:SHIFT|(?:LEFT|RIGHT):[a-z]+(?::[a-z]+)?)$/u.test(action),
            )
        )
            throw new Error("Parser and tagger resources are incompatible.");
        const lexicon = z
            .object({
                forms: z.record(
                    z.string(),
                    z.array(
                        z.object({
                            lemma: z.string(),
                            pos,
                            number: z.enum(["singular", "plural"]).optional(),
                            person: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
                            finite: z.boolean().optional(),
                            verbForm: z.string().optional(),
                            tense: z.string().optional(),
                        }),
                    ),
                ),
                frequency: z.record(z.string(), z.number().nonnegative()),
            })
            .parse(json(resources[2]!));
        const ort = await import("onnxruntime-web/wasm");
        ort.env.wasm.wasmPaths = new URL("runtime/", base).href;
        ort.env.wasm.numThreads = 1;
        const weights = await Promise.all(
            [metadata, parserMetadata].map((m) =>
                verifiedResource(new URL("weights/", base), m.artifact, m.sha256),
            ),
        );
        const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" as const };
        const tagger = await ort.InferenceSession.create(weights[0]!, options);
        let runtime: LocalSyntaxRuntime | undefined;
        try {
            runtime = new LocalSyntaxRuntime(
                ort,
                tagger,
                await ort.InferenceSession.create(weights[1]!, options),
                metadata,
                parserMetadata,
                lexicon,
            );
            if (registry.dictionary)
                runtime.dictionary = z
                    .object({ words: z.array(z.string().max(100)).max(500_000) })
                    .parse(
                        json(
                            await verifiedResource(
                                base,
                                registry.dictionary.path,
                                registry.dictionary.sha256,
                            ),
                        ),
                    ).words;
            if (registry.contextual)
                runtime.contextual = z
                    .object({
                        unigrams: z.record(z.string(), z.number().finite().nonnegative()),
                        bigrams: z.record(z.string(), z.number().finite().nonnegative()),
                        smoothing: z.number().positive(),
                        ranking: z
                            .object({
                                coefficients: z.array(z.number().finite()).length(3),
                                intercept: z.number().finite(),
                                scope: z.string(),
                            })
                            .optional(),
                        continuation: z.record(z.string(), z.number()).optional(),
                        followers: z.record(z.string(), z.number()).optional(),
                        totalTypes: z.number().positive().optional(),
                        discount: z.number().positive().optional(),
                    })
                    .parse(
                        json(
                            await verifiedResource(
                                base,
                                registry.contextual.path,
                                registry.contextual.sha256,
                            ),
                        ),
                    );
            if (registry.classifier) {
                runtime.classifierMetadata = classifierSchema.parse(
                    json(
                        await verifiedResource(
                            base,
                            registry.classifier.path,
                            registry.classifier.sha256,
                        ),
                    ),
                );
                const classifierWeights = await verifiedResource(
                    new URL("weights/", base),
                    runtime.classifierMetadata.artifact,
                    runtime.classifierMetadata.sha256,
                );
                runtime.classifier = await ort.InferenceSession.create(classifierWeights, options);
            }
            return runtime;
        } catch (error) {
            if (runtime) await runtime.dispose();
            else await tagger.release();
            throw error;
        }
    }
    private wordId(word: string): number {
        return Object.hasOwn(this.metadata.vocabulary, word.toLowerCase())
            ? this.metadata.vocabulary[word.toLowerCase()]!
            : 1;
    }
    async emissions(
        words: readonly number[],
        chars: readonly (readonly number[])[],
    ): Promise<number[]> {
        const output = await this.tagger.run({
            words: new this.ort.Tensor("int64", BigInt64Array.from(words.map(BigInt)), [
                1,
                words.length,
            ]),
            chars: new this.ort.Tensor("int64", BigInt64Array.from(chars.flat().map(BigInt)), [
                1,
                words.length,
                24,
            ]),
            lengths: new this.ort.Tensor("int64", BigInt64Array.of(BigInt(words.length)), [1]),
        });
        if (
            !output.emissions ||
            output.emissions.dims.join(",") !== `1,${words.length},${this.metadata.tags.length}`
        )
            throw new Error("Tagger output violates its schema.");
        return Array.from(output.emissions.data as Float32Array);
    }
    async tag(text: string, offset = 0): Promise<readonly Token[]> {
        const tokens = this.tokenizer.tokenize(text, offset);
        if (!tokens.length || tokens.length > 128) return tokens;
        const characters = tokens.map((t) => {
            const row = Array<number>(24).fill(0);
            [...t.text].slice(0, 24).forEach((c, i) => {
                row[i] = Object.hasOwn(this.metadata.characters, c)
                    ? this.metadata.characters[c]!
                    : 1;
            });
            return row;
        });
        const values = await this.emissions(
            tokens.map((t) => this.wordId(t.text)),
            characters,
        );
        const tags = viterbi(
            tokens.map((_, i) =>
                values.slice(i * this.metadata.tags.length, (i + 1) * this.metadata.tags.length),
            ),
            this.metadata.transitions,
            this.metadata.startScores,
            this.metadata.endScores,
        );
        return tokens.map((t, i) => {
            const p = this.metadata.tags[tags[i]!] as Pos;
            const matching = t.analyses.filter((a) => a.pos === p);
            return {
                ...t,
                pos: p,
                analyses: matching.length ? matching : [{ lemma: t.text.toLowerCase(), pos: p }],
            };
        });
    }
    private features(state: State, tokens: readonly Token[]): { words: bigint[]; tags: bigint[] } {
        const n = tokens.length,
            top = [0, 1, 2].map((i) => state.stack.at(-1 - i) ?? -1);
        const indices = [
            ...top,
            ...[0, 1, 2].map((i) => (state.pointer + i < n ? state.pointer + i : -1)),
            ...[top[0]!, top[1]!].flatMap((i) =>
                i < 0 ? [-1, -1] : [state.left[i]!, state.right[i]!],
            ),
        ];
        return {
            words: indices.map((i) =>
                BigInt(i < 0 ? 0 : i === n ? 2 : this.wordId(tokens[i]!.text)),
            ),
            tags: indices.map((i) =>
                BigInt(i < 0 ? 0 : i === n ? 1 : this.metadata.tags.indexOf(tokens[i]!.pos) + 2),
            ),
        };
    }
    async parse(
        tokens: readonly Token[],
        beamWidth = 4,
    ): Promise<Pick<Sentence, "graph" | "ambiguous" | "alternatives">> {
        const n = tokens.length;
        if (!n || n > 128) return { graph: [], ambiguous: true, alternatives: [] };
        let beam: State[] = [
            {
                stack: [n],
                pointer: 0,
                heads: Array<number>(n).fill(-1),
                relations: Array<string>(n).fill("dep"),
                left: Array<number>(n + 1).fill(-1),
                right: Array<number>(n + 1).fill(-1),
                score: 0,
            },
        ];
        const actions = this.parserMetadata.actions!;
        for (let step = 0; step < 2 * n; step++) {
            const features = beam.map((s) => this.features(s, tokens));
            const output = await this.parser.run({
                words: new this.ort.Tensor(
                    "int64",
                    BigInt64Array.from(features.flatMap((f) => f.words)),
                    [beam.length, 10],
                ),
                tags: new this.ort.Tensor(
                    "int64",
                    BigInt64Array.from(features.flatMap((f) => f.tags)),
                    [beam.length, 10],
                ),
            });
            if (
                !output.scores ||
                output.scores.dims.join(",") !== `${beam.length},${actions.length}`
            )
                throw new Error("Parser output violates its schema.");
            const expanded: State[] = [];
            beam.forEach((s, row) => {
                const scores = Array.from(
                    (output.scores!.data as Float32Array).slice(
                        row * actions.length,
                        (row + 1) * actions.length,
                    ),
                );
                const valid = actions.flatMap((a, i) =>
                    (
                        a === "SHIFT"
                            ? s.pointer < n
                            : s.stack.length >= 2 &&
                              (a.startsWith("LEFT:")
                                  ? s.stack.at(-2)! < n
                                  : s.stack.at(-1)! < n &&
                                    (s.stack.at(-2)! < n ||
                                        (s.pointer === n && s.stack.length === 2)))
                    )
                        ? [i]
                        : [],
                );
                const max = Math.max(...valid.map((i) => scores[i]!)),
                    normalizer =
                        max +
                        Math.log(valid.reduce((sum, i) => sum + Math.exp(scores[i]! - max), 0));
                for (const i of valid.sort((a, b) => scores[b]! - scores[a]!).slice(0, beamWidth)) {
                    const next: State = {
                        stack: [...s.stack],
                        pointer: s.pointer,
                        heads: [...s.heads],
                        relations: [...s.relations],
                        left: [...s.left],
                        right: [...s.right],
                        score: s.score + scores[i]! - normalizer,
                    };
                    const a = actions[i]!;
                    if (a === "SHIFT") next.stack.push(next.pointer++);
                    else {
                        const left = a.startsWith("LEFT:"),
                            head = next.stack.at(left ? -1 : -2)!,
                            dependent = next.stack.at(left ? -2 : -1)!;
                        next.heads[dependent] = head;
                        next.relations[dependent] = a.slice(a.indexOf(":") + 1);
                        next.left[head] =
                            next.left[head]! < 0
                                ? dependent
                                : Math.min(next.left[head]!, dependent);
                        next.right[head] = Math.max(next.right[head]!, dependent);
                        next.stack.splice(left ? -2 : -1, 1);
                    }
                    expanded.push(next);
                }
            });
            beam = expanded.sort((a, b) => b.score - a.score).slice(0, beamWidth);
            if (!beam.length) throw new Error("No valid bounded parser transitions remain.");
        }
        const alternatives = beam.slice(0, 2).map((s) => ({
            graph: s.heads.map((head, dependent) => ({
                head: head === n ? dependent : head,
                dependent,
                relation: s.relations[dependent]!,
            })),
            score: s.score,
        }));
        const graph = alternatives[0]!.graph,
            subjects = (g: readonly Dependency[]) =>
                g
                    .filter((e) => e.relation.startsWith("nsubj"))
                    .map((e) => `${e.head}:${e.dependent}`)
                    .join("|");
        return {
            graph,
            alternatives,
            ambiguous:
                !subjects(graph) ||
                (alternatives.length > 1 &&
                    alternatives[0]!.score - alternatives[1]!.score < 1 &&
                    subjects(graph) !== subjects(alternatives[1]!.graph)),
        };
    }
    async sentence(original: Sentence): Promise<Sentence> {
        const tokens = await this.tag(original.text, original.start);
        return tokens.length > 128
            ? original
            : { ...original, tokens, ...(await this.parse(tokens)), syntaxSource: "neural" };
    }
    private calibrationCohort(sentence: Sentence): boolean {
        if (
            sentence.tokens.length > 128 ||
            !sentence.tokens.length ||
            [...sentence.text].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)
        )
            return false;
        const retokenized = this.tokenizer.tokenize(sentence.text);
        if (
            retokenized.length !== sentence.tokens.length ||
            retokenized.some((token, index) => token.text !== sentence.tokens[index]!.text)
        )
            return false;
        // Calibration features require a train-derived morphology entry for every
        // parsed subject. Outside that cohort, emit review warnings without a
        // synthetic-task probability that the training data did not validate.
        return sentence.graph
            .filter((edge) => edge.relation === "nsubj")
            .every((edge) =>
                Object.hasOwn(
                    this.lexicon.forms,
                    sentence.tokens[edge.dependent]!.text.toLowerCase(),
                ),
            );
    }
    async classify(sentence: Sentence): Promise<readonly Diagnostic[]> {
        if (
            !this.classifier ||
            !this.classifierMetadata ||
            sentence.tokens.length > 128 ||
            !sentence.tokens.length
        )
            return [];
        const tokens = sentence.tokens,
            words: bigint[] = [],
            tags: bigint[] = [],
            features: number[] = [];
        tokens.forEach((token, index) => {
            const edge = sentence.graph.find((e) => e.dependent === index),
                head = edge?.relation === "root" ? -1 : (edge?.head ?? -1);
            const subject =
                sentence.graph.find(
                    (e) => e.relation === "nsubj" && (e.head === index || e.head === head),
                )?.dependent ?? -1;
            for (const i of [index - 2, index - 1, index, index + 1, index + 2, subject, head]) {
                words.push(BigInt(i >= 0 && i < tokens.length ? this.wordId(tokens[i]!.text) : 0));
                tags.push(
                    BigInt(
                        i >= 0 && i < tokens.length
                            ? this.metadata.tags.indexOf(tokens[i]!.pos) + 1
                            : 0,
                    ),
                );
            }
            const w = token.text.toLowerCase(),
                numbers =
                    subject < 0
                        ? []
                        : [
                              ...new Set(
                                  tokens[subject]!.analyses.map((a) => a.number).filter(Boolean),
                              ),
                          ],
                number = numbers.length === 1 ? numbers[0] : undefined;
            features.push(
                Number(!Object.hasOwn(this.lexicon.frequency, w)),
                number === "singular" ? 1 : number === "plural" ? -1 : 0,
                /^(is|was|has|does)$/u.test(w) ? 1 : /^(are|were|have|do)$/u.test(w) ? -1 : 0,
                Number(/^(has|have|had)$/iu.test(tokens[index - 1]?.text ?? "")),
                Number(/^(wrote|went|saw|ate|did|took|gave)$/u.test(w)),
                Number(w.endsWith("s")),
            );
        });
        const output = await this.classifier.run({
            words: new this.ort.Tensor("int64", BigInt64Array.from(words), [tokens.length, 7]),
            tags: new this.ort.Tensor("int64", BigInt64Array.from(tags), [tokens.length, 7]),
            features: new this.ort.Tensor("float32", Float32Array.from(features), [
                tokens.length,
                6,
            ]),
        });
        const scores = output.scores?.data as Float32Array | undefined;
        if (!scores || scores.length !== tokens.length * this.classifierMetadata.labels.length)
            throw new Error("Classifier output violates its schema.");
        const calibrated = this.calibrationCohort(sentence);
        const diagnostics: Diagnostic[] = [];
        tokens.forEach((token, row) => {
            for (let i = 1; i < this.classifierMetadata!.labels.length; i++) {
                const label = this.classifierMetadata!.labels[i]!,
                    calibration = this.classifierMetadata!.calibration[label];
                if (
                    !calibration?.available ||
                    calibration.a === undefined ||
                    calibration.b === undefined ||
                    calibration.threshold === undefined ||
                    label === "spelling"
                )
                    continue;
                const raw = scores[row * this.classifierMetadata!.labels.length + i]!,
                    probability = 1 / (1 + Math.exp(-(calibration.a * raw + calibration.b)));
                if (probability < calibration.threshold) continue;
                // Training mutations label predicate agreement and lexical verb form,
                // not arbitrary nouns, relative markers, or punctuation. Require the
                // learned POS prediction to support the category before emitting it.
                if (label === "agreement" && token.pos !== "AUX" && token.pos !== "VERB") continue;
                if (label === "verb-form" && token.pos !== "VERB") continue;
                const d = finding(
                    sentence,
                    `model-${label}`,
                    label === "agreement" ? "agreement" : "verb-forms",
                    token,
                    "Grammar",
                    "A local classifier suggests a review",
                    "A compact discriminative classifier found a pattern resembling its controlled training errors. This is review-only: its calibration is measured on synthetic EWT mutations and does not establish the probability of a natural essay error.",
                    [],
                    "Possible issue",
                );
                diagnostics.push({
                    ...d,
                    confidence: {
                        calibrated,
                        ...(calibrated ? { probability } : {}),
                        scope: calibration.scope,
                        policy: calibrated
                            ? "Calibrated on synthetic mutations only; review-only on essays."
                            : "Uncalibrated review warning outside the tokenization-stable training cohort.",
                    },
                });
            }
        });
        return diagnostics.slice(0, 3);
    }
    async dispose(): Promise<void> {
        await Promise.all([
            this.tagger.release(),
            this.parser.release(),
            this.classifier?.release(),
        ]);
    }
}
