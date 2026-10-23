import { MAX_TEXT, type AnalysisReport, type Diagnostic, type Sentence } from "./domain";
import { DiagnosticResolver, GrammarConstraintEngine } from "./grammar";
import {
    ConservativeDependencyParser,
    LexicalTagger,
    SentenceSegmenter,
    Tokenizer,
    paragraphs,
    type DependencyParser,
    type PartOfSpeechTagger,
} from "./text";

export class AnalysisPipeline {
    private readonly cache = new Map<
        string,
        { sentences: readonly Sentence[]; diagnostics: readonly Diagnostic[] }
    >();
    constructor(
        private readonly tokenizer: Tokenizer,
        private readonly segmenter: SentenceSegmenter,
        private readonly tagger: PartOfSpeechTagger,
        private readonly parser: DependencyParser,
        private readonly constraints: GrammarConstraintEngine,
        private readonly resolver: DiagnosticResolver,
    ) {}
    analyze(text: string, revision = 0, style = false): AnalysisReport {
        if (text.length > MAX_TEXT) throw new Error("Documents are limited to 150,000 characters.");
        const began = performance.now();
        const sentences: Sentence[] = [],
            diagnostics: Diagnostic[] = [];
        let cachedParagraphs = 0;
        for (const paragraph of paragraphs(text)) {
            let cached = this.cache.get(paragraph.text);
            if (!cached) {
                const local = this.segmenter.segment(paragraph.text).map((part, i) => {
                    const tokens = this.tagger.tag(this.tokenizer.tokenize(part.text, part.start));
                    const parsed = this.parser.parse(tokens);
                    return { ...part, id: `s${i}`, tokens, ...parsed };
                });
                cached = {
                    sentences: local,
                    diagnostics: local.flatMap((s) => {
                        const baseline = this.constraints.evaluate(s);
                        return baseline.map((d) => ({
                            ...d,
                            proposals: d.proposals.flatMap((p) => {
                                // Bound revalidation work and abstain on pathologically long sentences.
                                if (s.tokens.length > 512 || p.edits.length > 8) return [];
                                let corrected = s.text;
                                for (const edit of [...p.edits].sort((a, b) => b.start - a.start)) {
                                    if (
                                        s.text.slice(edit.start - s.start, edit.end - s.start) !==
                                        edit.expected
                                    )
                                        return [];
                                    corrected =
                                        corrected.slice(0, edit.start - s.start) +
                                        edit.replacement +
                                        corrected.slice(edit.end - s.start);
                                }
                                const tokens = this.tagger.tag(this.tokenizer.tokenize(corrected));
                                const parsed = this.parser.parse(tokens);
                                const candidate: Sentence = {
                                    start: 0,
                                    end: corrected.length,
                                    text: corrected,
                                    id: "candidate",
                                    tokens,
                                    ...parsed,
                                };
                                const after = this.constraints.evaluate(candidate);
                                if (
                                    after.filter((issue) => issue.ruleId === d.ruleId).length >=
                                        baseline.filter((issue) => issue.ruleId === d.ruleId)
                                            .length ||
                                    after.some(
                                        (issue) =>
                                            !baseline.some(
                                                (original) => original.ruleId === issue.ruleId,
                                            ),
                                    )
                                )
                                    return [];
                                return [
                                    {
                                        ...p,
                                        validation: {
                                            status: "rechecked" as const,
                                            checks: [
                                                "Exact source match",
                                                "Bounded edits preserve unrelated text",
                                                "Target rule count decreases",
                                                "No new supported rule category",
                                            ],
                                        },
                                    },
                                ];
                            }),
                        }));
                    }),
                };
                if (this.cache.size > 250) this.cache.delete(this.cache.keys().next().value!);
                this.cache.set(paragraph.text, cached);
            } else cachedParagraphs++;
            const shift = paragraph.start;
            const span = <T extends { start: number; end: number }>(s: T): T => ({
                ...s,
                start: s.start + shift,
                end: s.end + shift,
            });
            sentences.push(
                ...cached.sentences.map((s) => ({
                    ...span(s),
                    id: `s:${s.start + shift}`,
                    tokens: s.tokens.map(span),
                })),
            );
            diagnostics.push(
                ...cached.diagnostics.map((d) => ({
                    ...span(d),
                    id: `${d.ruleId}:${d.start + shift}:${d.end + shift}`,
                    evidence: d.evidence.map(span),
                    proposals: d.proposals.map((p) => ({ ...p, edits: p.edits.map(span) })),
                })),
            );
        }
        if (style) {
            // A document-level observation is opt-in and never labelled as a grammar error.
            const starts = new Map<string, Sentence[]>();
            for (const s of sentences) {
                const phrase = s.tokens
                    .filter((t) => t.pos !== "PUNCT")
                    .slice(0, 3)
                    .map((t) => t.text.toLowerCase())
                    .join(" ");
                if (phrase.split(" ").length === 3)
                    starts.set(phrase, [...(starts.get(phrase) ?? []), s]);
            }
            for (const [phrase, group] of starts)
                if (group.length >= 3) {
                    const target = group.at(-1)!;
                    const openingSpan = (s: Sentence) => {
                        const tokens = s.tokens.filter((t) => t.pos !== "PUNCT").slice(0, 3);
                        return { start: tokens[0]!.start, end: tokens.at(-1)!.end };
                    };
                    diagnostics.push({
                        ...openingSpan(target),
                        id: `repetition:${target.start}`,
                        ruleId: "document-repetition",
                        category: "Style",
                        skill: "usage",
                        title: "A sentence opening repeats",
                        explanation: `The opening “${phrase}” occurs ${group.length} times. Repetition can be deliberate; consider variety only if it improves the passage.`,
                        certainty: "Style suggestion",
                        evidence: group.map((s) => ({
                            ...openingSpan(s),
                            label: "Repeated opening",
                        })),
                        confidence: {
                            calibrated: false,
                            policy: "Optional document-level observation; no correctness claim.",
                        },
                        proposals: [],
                    });
                }
        }
        return {
            revision,
            text,
            sentences,
            diagnostics: this.resolver.resolve(diagnostics),
            elapsedMs: performance.now() - began,
            cachedParagraphs,
            versions: {
                engine: "0.2.0",
                rules: "1.1.0",
                syntax: "lexical-fallback-1",
                exercises: "1.1.0",
            },
            limitations: [
                "Deterministic checks only. No trained POS tagger, parser, or error classifier is bundled.",
                "Syntax diagrams are provisional lexical analyses; ambiguous constructions require human review.",
                "Confidence policies are heuristic, not calibrated probabilities. Coverage is limited to documented constructions.",
            ],
        };
    }
}
export function createPipeline(): AnalysisPipeline {
    return new AnalysisPipeline(
        new Tokenizer(),
        new SentenceSegmenter(),
        new LexicalTagger(),
        new ConservativeDependencyParser(),
        new GrammarConstraintEngine(),
        new DiagnosticResolver(),
    );
}
