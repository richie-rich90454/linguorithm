import type { AnalysisReport, CorrectionProposal, Diagnostic, Sentence } from "./domain";
import { createPipeline } from "./pipeline";
import { EssayDocument } from "./domain";
import { DiagnosticResolver, finding, GrammarConstraintEngine } from "./grammar";
import { advancedRules, documentRelationships } from "./advanced-grammar";
import { SpellingIndex, editDistance } from "./spelling";

export interface ContextualTables {
    unigrams: Record<string, number>;
    bigrams: Record<string, number>;
    smoothing: number;
    continuation?: Record<string, number>;
    followers?: Record<string, number>;
    totalTypes?: number;
    discount?: number;
    ranking?: { coefficients: number[]; intercept: number; scope: string };
}
export class CandidateRanker {
    private readonly vocabularySize: number;
    constructor(private readonly tables: ContextualTables) {
        this.vocabularySize = Object.keys(tables.unigrams).length + 1;
    }
    features(sentence: Sentence, proposal: CorrectionProposal): number[] {
        const edit = proposal.edits[0];
        if (!edit) return [0, 0, 0];
        const index = sentence.tokens.findIndex((t) => t.start >= edit.start),
            previous = sentence.tokens[index - 1]?.text.toLowerCase() ?? "<s>",
            next = sentence.tokens[index + 1]?.text.toLowerCase() ?? "</s>",
            word = edit.replacement.toLowerCase(),
            smoothing = this.tables.smoothing;
        const probability = (a: string, b: string) => {
            const count = this.tables.bigrams[a + "\0" + b] ?? 0,
                total = this.tables.unigrams[a] ?? 0;
            if (this.tables.continuation && this.tables.followers && this.tables.totalTypes) {
                const continuation = (this.tables.continuation[b] ?? 1) / this.tables.totalTypes,
                    discount = this.tables.discount ?? 0.75;
                return Math.log(
                    Math.max(
                        1e-12,
                        total
                            ? Math.max(0, count - discount) / total +
                                  ((discount * (this.tables.followers[a] ?? 0)) / total) *
                                      continuation
                            : continuation,
                    ),
                );
            }
            return Math.log((count + smoothing) / (total + smoothing * this.vocabularySize));
        };
        return [
            Math.log1p(this.tables.unigrams[word] ?? 0),
            probability(previous, word) + probability(word, next),
            -editDistance(edit.expected.slice(0, 40), edit.replacement.slice(0, 40)),
        ];
    }
    rank(sentence: Sentence, proposals: readonly CorrectionProposal[]): CorrectionProposal[] {
        if (!this.tables.ranking) return [...proposals];
        const { coefficients, intercept } = this.tables.ranking;
        const score = (p: CorrectionProposal) =>
            this.features(sentence, p).reduce(
                (sum, value, i) => sum + value * (coefficients[i] ?? 0),
                intercept,
            );
        return [...proposals].sort((a, b) => score(b) - score(a));
    }
}
export interface AsyncSyntax {
    sentence(sentence: Sentence): Promise<Sentence>;
    classify?(sentence: Sentence): Promise<readonly Diagnostic[]>;
    lexicon: { frequency: Record<string, number> };
    dictionary?: readonly string[];
    contextual?: ContextualTables;
    metadata: { version: string; limitations: string[] };
}
export class HybridAnalysisPipeline {
    private readonly fallback = createPipeline();
    private readonly constraints = new GrammarConstraintEngine(advancedRules);
    private readonly resolver = new DiagnosticResolver();
    private readonly cache = new Map<string, Sentence>();
    private readonly spelling?: SpellingIndex;
    private readonly ranker?: CandidateRanker;
    constructor(private readonly syntax: AsyncSyntax) {
        if (syntax.dictionary)
            this.spelling = new SpellingIndex(syntax.dictionary, syntax.lexicon.frequency, 2);
        if (syntax.contextual) this.ranker = new CandidateRanker(syntax.contextual);
    }
    async analyze(
        text: string,
        revision = 0,
        style = false,
        personalDictionary: readonly string[] = [],
    ): Promise<AnalysisReport> {
        const started = performance.now(),
            report = this.fallback.analyze(text, revision, style),
            sentences: Sentence[] = [],
            diagnostics = [...report.diagnostics];
        const personal = new Set(personalDictionary.map((w) => w.toLowerCase()));
        for (const original of report.sentences) {
            let local = this.cache.get(original.text);
            if (!local) {
                local = await this.syntax.sentence({
                    ...original,
                    start: 0,
                    end: original.text.length,
                    tokens: original.tokens.map((t) => ({
                        ...t,
                        start: t.start - original.start,
                        end: t.end - original.start,
                    })),
                });
                if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
                this.cache.set(original.text, local);
            }
            const sentence = {
                ...local,
                id: original.id,
                start: original.start,
                end: original.end,
                tokens: local.tokens.map((t) => ({
                    ...t,
                    start: t.start + original.start,
                    end: t.end + original.start,
                })),
            };
            sentences.push(sentence);
            const extra = this.constraints.evaluate(sentence);
            for (const token of sentence.tokens) {
                if (
                    !this.spelling ||
                    this.spelling.has(token.text) ||
                    personal.has(token.text.toLowerCase()) ||
                    token.pos === "PROPN" ||
                    !/^[a-z]{5,24}$/u.test(token.text) ||
                    diagnostics.some((d) => d.start <= token.start && d.end >= token.end)
                )
                    continue;
                const candidates = this.spelling.candidates(token.text);
                if (candidates.length)
                    extra.push(
                        finding(
                            sentence,
                            "dictionary-spelling",
                            "usage",
                            token,
                            "Spelling",
                            "Review an unfamiliar word",
                            "This word is absent from the installed American English dictionary and has nearby common-word candidates. Names, technical vocabulary, and uncommon valid words may be absent; dismiss or add them to your personal dictionary.",
                            candidates,
                            "Possible issue",
                        ),
                    );
            }
            if (this.syntax.classify) extra.push(...(await this.syntax.classify(sentence)));
            for (const d of extra) {
                const safe: CorrectionProposal[] = [];
                for (const p of (this.ranker?.rank(sentence, d.proposals) ?? d.proposals).slice(
                    0,
                    3,
                )) {
                    try {
                        const local = {
                            ...p,
                            edits: p.edits.map((e) => ({
                                ...e,
                                start: e.start - sentence.start,
                                end: e.end - sentence.start,
                            })),
                        };
                        const corrected = EssayDocument.create(sentence.text).apply(local).text;
                        const before = this.fallback.analyze(sentence.text),
                            after = this.fallback.analyze(corrected);
                        if (
                            after.diagnostics.some(
                                (issue) =>
                                    !before.diagnostics.some((old) => old.ruleId === issue.ruleId),
                            )
                        )
                            continue;
                        // Reparse only bounded rule repairs; dictionary alternatives are lexical reviews.
                        if (d.ruleId !== "dictionary-spelling") {
                            const candidate = await this.syntax.sentence({
                                ...sentence,
                                start: 0,
                                end: corrected.length,
                                text: corrected,
                                tokens: [],
                            });
                            if (
                                this.constraints
                                    .evaluate(candidate)
                                    .some((issue) => issue.ruleId === d.ruleId)
                            )
                                continue;
                        }
                        safe.push({
                            ...p,
                            validation: {
                                status: "rechecked",
                                checks: [
                                    "Exact source match and bounded edits",
                                    "No new deterministic rule category",
                                    d.ruleId === "dictionary-spelling"
                                        ? "Installed dictionary candidate; human review required"
                                        : "Target constraint absent after reparsing",
                                ],
                            },
                        });
                    } catch {
                        /* Unsafe or stale candidate is withheld. */
                    }
                }
                diagnostics.push({ ...d, proposals: safe });
            }
        }
        diagnostics.push(...documentRelationships(sentences, style));
        return {
            ...report,
            sentences,
            diagnostics: this.resolver.resolve(
                diagnostics.filter(
                    (d) =>
                        !(
                            d.category === "Spelling" &&
                            personal.has(text.slice(d.start, d.end).toLowerCase())
                        ),
                ),
            ),
            elapsedMs: performance.now() - started,
            versions: {
                ...report.versions,
                syntax: this.syntax.metadata.version,
                classifier: this.syntax.metadata.version,
            },
            limitations: this.syntax.metadata.limitations,
            modelStatus: {
                state: "ready",
                detail: "Local BiLSTM/CRF tagging and bounded-beam dependency parsing; neural error scores are review-only and synthetic-task calibrated.",
                tasks: ["pos", "parser", "error-classifier", "dictionary", "contextual-ranking"],
            },
        };
    }
}
