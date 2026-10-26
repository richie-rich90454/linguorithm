import type {
    AnalysisReport,
    CorrectionProposal,
    Diagnostic,
    Edit,
    Morphology,
    Sentence,
    WritingIntent,
} from "./domain";
import { createPipeline } from "./pipeline";
import { attachGoalMetadata } from "./goal-metadata";
import { EssayDocument } from "./domain";
import { DiagnosticResolver, finding, GrammarConstraintEngine } from "./grammar";
import { advancedRules, createAdvancedRules, documentRelationships } from "./advanced-grammar";
import { documentFeedback } from "./document-feedback";
import { writingGoalObservations } from "./writing-goal-cues";
import {
    CountNounInflections,
    PastParticipleInflections,
    PresentVerbInflections,
} from "./inflections";
import { SpellingIndex, editDistance } from "./spelling";
import { ConservativeDependencyParser } from "./text";

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
    lexicon: {
        frequency: Record<string, number>;
        forms?: Readonly<Record<string, readonly Morphology[]>>;
    };
    dictionary?: readonly string[];
    contextual?: ContextualTables;
    metadata: { version: string; limitations: string[] };
}
export class HybridAnalysisPipeline {
    private readonly fallback = createPipeline();
    private readonly constraints: GrammarConstraintEngine;
    private readonly resolver = new DiagnosticResolver();
    private readonly cache = new Map<string, Sentence>();
    private readonly spelling?: SpellingIndex;
    private readonly ranker?: CandidateRanker;
    constructor(private readonly syntax: AsyncSyntax) {
        if (syntax.dictionary)
            this.spelling = new SpellingIndex(syntax.dictionary, syntax.lexicon.frequency, 2);
        this.constraints = new GrammarConstraintEngine(
            syntax.lexicon.forms
                ? createAdvancedRules(
                      new PresentVerbInflections(
                          syntax.lexicon.forms,
                          (word) => this.spelling?.has(word) ?? false,
                      ),
                      new PastParticipleInflections(syntax.lexicon.forms),
                      new CountNounInflections(syntax.lexicon.forms),
                  )
                : advancedRules,
        );
        if (syntax.contextual) this.ranker = new CandidateRanker(syntax.contextual);
    }
    async analyze(
        text: string,
        revision = 0,
        style = false,
        personalDictionary: readonly string[] = [],
        writingIntent: WritingIntent = "general",
    ): Promise<AnalysisReport> {
        const started = performance.now(),
            report = this.fallback.analyze(text, revision, style, writingIntent),
            sentences: Sentence[] = [],
            diagnostics: Diagnostic[] = [];
        const personal = new Set(personalDictionary.map((w) => w.toLowerCase()));
        let lexicalAbstentions = 0;
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
            const words = sentence.tokens.filter((t) => /^[\p{L}\p{M}]+$/u.test(t.text));
            const recognized = words.filter(
                (t) => this.spelling?.has(t.text) || personal.has(t.text.toLowerCase()),
            ).length;
            // Low dictionary coverage is not language identification. It is a reason
            // to abstain from English corrections on foreign or highly specialized text.
            if (this.spelling && words.length >= 5 && recognized * 2 < words.length) {
                lexicalAbstentions++;
                continue;
            }
            const baseline = report.diagnostics.filter(
                (d) => d.start >= sentence.start && d.end <= sentence.end,
            );
            const extra = this.constraints.evaluate(sentence),
                replacedSpellings = new Set<Diagnostic>();
            for (const token of sentence.tokens) {
                const lower = token.text.toLowerCase(),
                    sentenceInitial = token.start === sentence.start,
                    acceptableCase = /^[a-z]{5,24}$/u.test(token.text),
                    baselineSpelling = baseline.find(
                        (d) =>
                            d.category === "Spelling" &&
                            d.start <= token.start &&
                            d.end >= token.end,
                    );
                if (
                    !this.spelling ||
                    this.spelling.has(lower) ||
                    personal.has(lower) ||
                    !acceptableCase ||
                    baseline.some(
                        (d) =>
                            d.category !== "Spelling" &&
                            d.start <= token.start &&
                            d.end >= token.end,
                    )
                )
                    continue;
                const split = this.spelling.splitConcatenated(lower),
                    candidates = this.spelling.candidates(lower),
                    properNameSafeSplit = token.pos !== "PROPN";
                if (split && candidates.length && properNameSafeSplit) {
                    if (baselineSpelling) replacedSpellings.add(baselineSpelling);
                    const replacement = sentenceInitial
                        ? `${split[0]?.toUpperCase()}${split.slice(1)}`
                        : split;
                    extra.push(
                        finding(
                            sentence,
                            "missing-word-space",
                            "punctuation",
                            token,
                            "Punctuation",
                            "Separate the words",
                            `This unfamiliar token has one well-supported word boundary: “${replacement}”.`,
                            [replacement],
                            "Possible issue",
                        ),
                    );
                    continue;
                }
                if (baselineSpelling || token.pos === "PROPN") continue;
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
            const classifierBefore = (await this.syntax.classify?.(sentence)) ?? [];
            extra.push(...classifierBefore);
            const before = this.fallback.analyze(sentence.text).diagnostics;
            const advancedBefore = this.constraints.evaluate(sentence);
            const counts = (issues: readonly Diagnostic[]) => {
                const result = new Map<string, number>();
                for (const issue of issues)
                    result.set(issue.ruleId, (result.get(issue.ruleId) ?? 0) + 1);
                return result;
            };
            const deterministicCounts = counts(before);
            const advancedCounts = counts(advancedBefore);
            const classifierCounts = counts(classifierBefore);
            const localize = (issues: readonly Diagnostic[]) =>
                issues.map((issue) => ({
                    ...issue,
                    start: issue.start - sentence.start,
                    end: issue.end - sentence.start,
                }));
            const introducesIssue = (
                issues: readonly Diagnostic[],
                previous: readonly Diagnostic[],
                edits: readonly Edit[],
            ) => {
                const ordered = [...edits].sort((a, b) => a.start - b.start);
                const remap = (position: number, end: boolean) => {
                    let shift = 0;
                    for (const edit of ordered) {
                        if (position < edit.start) break;
                        if (position >= edit.end) {
                            shift += edit.replacement.length - (edit.end - edit.start);
                            continue;
                        }
                        return edit.start + shift + (end ? edit.replacement.length : 0);
                    }
                    return position + shift;
                };
                const identity = (rule: string, start: number, end: number) =>
                    `${rule}:${start}:${end}`;
                const remaining = new Map<string, number>();
                for (const old of previous) {
                    const key = identity(old.ruleId, remap(old.start, false), remap(old.end, true));
                    remaining.set(key, (remaining.get(key) ?? 0) + 1);
                }
                return issues.some((issue) => {
                    const key = identity(issue.ruleId, issue.start, issue.end);
                    const count = remaining.get(key) ?? 0;
                    if (!count) return true;
                    remaining.set(key, count - 1);
                    return false;
                });
            };
            const reparsed = new Map<
                string,
                Promise<{ rules: Diagnostic[]; classifier: readonly Diagnostic[] }>
            >();
            for (const d of [
                ...baseline.filter((item) => !replacedSpellings.has(item)),
                ...extra,
            ]) {
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
                        const fallbackAfter = this.fallback.analyze(corrected);
                        const after = fallbackAfter.diagnostics;
                        if (
                            introducesIssue(after, before, local.edits) ||
                            ((deterministicCounts.get(d.ruleId) ?? 0) > 0 &&
                                (counts(after).get(d.ruleId) ?? 0) >=
                                    deterministicCounts.get(d.ruleId)!)
                        )
                            continue;
                        // Every proposal, including fallback and spelling repairs, must pass
                        // the same structural checks. Share reparses for equivalent edits.
                        let pending = reparsed.get(corrected);
                        if (!pending) {
                            pending = (async () => {
                                let candidate = this.cache.get(corrected);
                                if (!candidate) {
                                    const tokens = fallbackAfter.sentences.flatMap((s) => s.tokens);
                                    candidate = await this.syntax.sentence({
                                        id: "candidate",
                                        start: 0,
                                        end: corrected.length,
                                        text: corrected,
                                        tokens,
                                        ...new ConservativeDependencyParser().parse(tokens),
                                        syntaxSource: "lexical",
                                    });
                                    if (this.cache.size >= 500)
                                        this.cache.delete(this.cache.keys().next().value!);
                                    this.cache.set(corrected, candidate);
                                }
                                return {
                                    rules: this.constraints.evaluate(candidate),
                                    classifier: (await this.syntax.classify?.(candidate)) ?? [],
                                };
                            })();
                            reparsed.set(corrected, pending);
                        }
                        const candidate = await pending;
                        if (
                            introducesIssue(
                                candidate.rules,
                                localize(advancedBefore),
                                local.edits,
                            ) ||
                            introducesIssue(
                                candidate.classifier,
                                localize(classifierBefore),
                                local.edits,
                            ) ||
                            ((advancedCounts.get(d.ruleId) ?? 0) > 0 &&
                                (counts(candidate.rules).get(d.ruleId) ?? 0) >=
                                    advancedCounts.get(d.ruleId)!) ||
                            ((classifierCounts.get(d.ruleId) ?? 0) > 0 &&
                                (counts(candidate.classifier).get(d.ruleId) ?? 0) >=
                                    classifierCounts.get(d.ruleId)!)
                        )
                            continue;
                        safe.push({
                            ...p,
                            validation: {
                                status: "rechecked",
                                checks: [
                                    "Exact source match and bounded edits",
                                    "No new deterministic or parsed finding after mapping source spans through edits",
                                    "No new contextual classifier finding after mapping source spans through edits",
                                    "Parsed constraints checked; lexical fallback above the model token limit",
                                    d.ruleId === "dictionary-spelling"
                                        ? "Installed dictionary candidate reparsed; human review required"
                                        : "Target supported finding decreases after reparsing",
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
        diagnostics.push(...documentFeedback(sentences, text, style));
        diagnostics.push(...documentRelationships(sentences, style, writingIntent));
        if (style) diagnostics.push(...writingGoalObservations(sentences, text, writingIntent));
        return attachGoalMetadata(
            {
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
                limitations: [
                    ...this.syntax.metadata.limitations,
                    ...(lexicalAbstentions
                        ? [
                              `English corrections withheld for ${lexicalAbstentions} sentence(s) with insufficient dictionary coverage; language and specialized vocabulary require human review.`,
                          ]
                        : []),
                ],
                modelStatus: {
                    state: "ready",
                    detail: "Local BiLSTM/CRF tagging and bounded-beam dependency parsing; neural error scores are review-only and synthetic-task calibrated.",
                    tasks: [
                        "pos",
                        "parser",
                        "error-classifier",
                        "dictionary",
                        "contextual-ranking",
                    ],
                },
            },
            writingIntent,
        );
    }
}
