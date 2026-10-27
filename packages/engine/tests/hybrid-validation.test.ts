import { describe, expect, it } from "vitest";
import { EssayDocument, type Diagnostic, type Sentence } from "../src/domain";
import { HybridAnalysisPipeline, type AsyncSyntax } from "../src/hybrid";
import { finding } from "../src/grammar";
import { LexicalTagger, Tokenizer } from "../src/text";

function parsed(text: string, comparisons = 0): Sentence {
    const tokens = new LexicalTagger().tag(new Tokenizer().tokenize(text));
    const graph = [
        ["better", "more"],
        ["best", "most"],
    ]
        .slice(0, comparisons)
        .map(([head, dependent]) => ({
            head: tokens.findIndex((t) => t.text === head),
            dependent: tokens.findIndex((t) => t.text === dependent),
            relation: "advmod",
        }));
    return {
        id: "fixture",
        text,
        start: 0,
        end: text.length,
        tokens,
        graph,
        ambiguous: false,
        syntaxSource: "neural",
    };
}

function parsedDependentClause(text: string): Sentence {
    const result = parsed(text),
        index = (word: string) =>
            result.tokens.findIndex((token) => token.text.toLowerCase() === word),
        tokens = result.tokens.map((token) => {
            if (token.text === "was")
                return {
                    ...token,
                    pos: "AUX" as const,
                    analyses: [
                        {
                            lemma: "be",
                            pos: "AUX" as const,
                            finite: true,
                            tense: "Past",
                            verbForm: "Fin",
                        },
                    ],
                };
            if (token.text === "late")
                return {
                    ...token,
                    pos: "ADJ" as const,
                    analyses: [{ lemma: "late", pos: "ADJ" as const }],
                };
            return token;
        }),
        late = index("late");
    return {
        ...result,
        tokens,
        graph: [
            { head: late, dependent: late, relation: "root" },
            { head: late, dependent: index("was"), relation: "cop" },
            { head: late, dependent: index("it"), relation: "nsubj" },
            { head: late, dependent: index("because"), relation: "mark" },
        ],
    };
}

function pipeline(options: Partial<AsyncSyntax> = {}) {
    return new HybridAnalysisPipeline({
        lexicon: { frequency: {} },
        metadata: { version: "controlled-validation-fixture", limitations: [] },
        sentence: async (s) => parsed(s.text),
        ...options,
    });
}

describe("hybrid proposal safety across analysis stages", () => {
    it("suggests an evidence-backed space for a uniquely segmented merged word", async () => {
        const report = await pipeline({
            dictionary: ["we", "should", "finish", "today"],
            lexicon: { frequency: { we: 919, should: 244, finish: 30, today: 100 } },
        }).analyze("weshould finish today.");
        const issue = report.diagnostics.find(
            (diagnostic) => diagnostic.ruleId === "missing-word-space",
        );
        expect(
            issue,
            JSON.stringify(
                report.diagnostics.map((diagnostic) => ({
                    ruleId: diagnostic.ruleId,
                    start: diagnostic.start,
                    end: diagnostic.end,
                    title: diagnostic.title,
                    replacements: diagnostic.proposals.flatMap((proposal) =>
                        proposal.edits.map((edit) => edit.replacement),
                    ),
                })),
            ),
        ).toBeDefined();
        expect(issue?.goalId).toBe("writing.spacing");
        expect(
            issue?.proposals.flatMap((proposal) => proposal.edits.map((edit) => edit.replacement)),
        ).toContain("We should");
        expect(issue?.start).toBe(0);
        expect(issue?.end).toBe("Weshould".length);
    });

    it("keeps the established four-letter merged-word correction", async () => {
        const report = await pipeline({
            dictionary: ["we", "wrote", "a", "lot", "today"],
            lexicon: { frequency: { we: 919, wrote: 70, a: 3776, lot: 93, today: 100 } },
        }).analyze("We wrote alot today.");
        const issue = report.diagnostics.find((diagnostic) => diagnostic.category === "Spelling");
        expect(issue).toBeDefined();
        expect(
            issue?.proposals.flatMap((proposal) => proposal.edits.map((edit) => edit.replacement)),
        ).toContain("a lot");
    });

    it("does not turn the valid word forex into an unsupported split", async () => {
        const report = await pipeline({
            dictionary: ["we", "trade", "for", "ex", "markets", "move", "today"],
            lexicon: {
                frequency: {
                    we: 919,
                    trade: 180,
                    for: 755,
                    ex: 11,
                    markets: 34,
                    move: 60,
                    today: 100,
                },
            },
        }).analyze("We trade forex markets today.");
        expect(
            report.diagnostics
                .filter((diagnostic) => diagnostic.ruleId === "missing-word-space")
                .map((diagnostic) => [
                    diagnostic.start,
                    diagnostic.end,
                    diagnostic.proposals.flatMap((proposal) =>
                        proposal.edits.map((edit) => edit.replacement),
                    ),
                ]),
        ).toEqual([]);
        expect(
            report.diagnostics
                .filter((diagnostic) => diagnostic.ruleId === "dictionary-spelling")
                .flatMap((diagnostic) =>
                    diagnostic.proposals.flatMap((proposal) =>
                        proposal.edits.map((edit) => edit.replacement),
                    ),
                ),
        ).not.toContain("for ex");
    });

    it("does not split proper names or valid unfamiliar compounds", async () => {
        const report = await pipeline({
            dictionary: [
                "reg",
                "an",
                "life",
                "world",
                "discusses",
                "the",
                "today",
                "at",
                "hens",
                "athena",
                "welcomes",
                "guests",
            ],
            lexicon: {
                frequency: {
                    an: 499,
                    life: 80,
                    world: 137,
                    discusses: 25,
                    the: 9066,
                    today: 69,
                    at: 850,
                    hens: 7,
                    athena: 9,
                    welcomes: 24,
                    guests: 56,
                },
            },
            sentence: async (s) => {
                const result = parsed(s.text);
                return {
                    ...result,
                    tokens: result.tokens.map((token) =>
                        token.text === "Athens" ? { ...token, pos: "PROPN" } : token,
                    ),
                };
            },
        }).analyze("Regan discusses the lifeworld today. Athens welcomes guests today.");
        expect(
            report.diagnostics
                .filter((diagnostic) => diagnostic.ruleId === "missing-word-space")
                .map((diagnostic) => [
                    diagnostic.start,
                    diagnostic.end,
                    diagnostic.proposals.flatMap((proposal) =>
                        proposal.edits.map((edit) => edit.replacement),
                    ),
                ]),
        ).toEqual([]);
    });

    it("accepts a dependent clause as an answer to the preceding question", async () => {
        const report = await pipeline({
            sentence: async (sentence) =>
                sentence.text.startsWith("Because")
                    ? parsedDependentClause(sentence.text)
                    : parsed(sentence.text),
        }).analyze("Why did they leave? Because it was late.");

        expect(
            report.diagnostics.filter((diagnostic) => diagnostic.ruleId === "dependent-fragment"),
        ).toEqual([]);
    });

    it("continues to review a standalone dependent clause without question context", async () => {
        const report = await pipeline({
            sentence: async (sentence) =>
                sentence.text.startsWith("Because")
                    ? parsedDependentClause(sentence.text)
                    : parsed(sentence.text),
        }).analyze("They waited. Because it was late.");

        const [issue] = report.diagnostics.filter(
            (diagnostic) => diagnostic.ruleId === "dependent-fragment",
        );
        expect(issue).toBeDefined();
        expect(issue!.start).toBe(report.text.indexOf("Because"));
        expect(report.text.slice(issue!.start, issue!.end)).toBe("Because it was late.");
        expect(issue!.evidence.map((evidence) => evidence.label)).toEqual(
            expect.arrayContaining(["Subordinating marker", "Dependent predicate"]),
        );
    });

    it("withholds a fallback repair when its neural reparse reveals a new constraint", async () => {
        const report = await pipeline({
            sentence: async (s) => parsed(s.text, s.text.includes(" are ") ? 1 : 0),
        }).analyze("They is more better.");
        const issue = report.diagnostics.find((d) => d.ruleId === "agreement");
        expect(issue).toBeDefined();
        expect(issue!.proposals).toEqual([]);
    });

    it("reparses dictionary alternatives and withholds newly introduced grammar findings", async () => {
        const reparses: string[] = [];
        const report = await pipeline({
            dictionary: ["this", "reads", "more", "better"],
            lexicon: { frequency: { better: 500 } },
            sentence: async (s) => {
                reparses.push(s.text);
                return parsed(s.text, s.text.includes("better") ? 1 : 0);
            },
        }).analyze("This reads more bettr.");
        const issue = report.diagnostics.find((d) => d.ruleId === "dictionary-spelling");
        expect(issue).toBeDefined();
        expect(reparses).toContain("This reads more better.");
        expect(issue!.proposals).toEqual([]);
    });

    it("abstains when local corpus context strongly favors the observed spelling", async () => {
        const report = await pipeline({
            dictionary: ["the", "quaternion", "appears"],
            lexicon: { frequency: { the: 1_000, quaternion: 100, appears: 100 } },
            contextual: {
                smoothing: 0.1,
                unigrams: { the: 1_000, quaterinon: 10, quaternion: 100, appears: 100 },
                bigrams: {
                    "the\u0000quaterinon": 100,
                    "quaterinon\u0000appears": 10,
                },
            },
        }).analyze("The quaterinon appears.");

        expect(
            report.diagnostics.some((diagnostic) => diagnostic.ruleId === "dictionary-spelling"),
        ).toBe(false);
    });

    it("keeps a spelling suggestion when the corpus context supports its correction", async () => {
        const report = await pipeline({
            dictionary: ["I", "study", "quaternion", "daily"],
            lexicon: { frequency: { i: 1_000, study: 50, quaternion: 100, daily: 50 } },
            contextual: {
                smoothing: 0.1,
                unigrams: { i: 1_000, study: 50, quaternion: 100, quaterinon: 1, daily: 50 },
                bigrams: {
                    "i\u0000study": 500,
                    "study\u0000quaternion": 20,
                    "quaternion\u0000daily": 40,
                },
            },
        }).analyze("I study quaterinon daily.");

        const issue = report.diagnostics.find(
            (diagnostic) => diagnostic.ruleId === "dictionary-spelling",
        );
        expect(issue?.proposals[0]?.edits[0]?.replacement).toBe("quaternion");
    });

    it("rejects an increased finding count even when the same rule already existed", async () => {
        const report = await pipeline({
            sentence: async (s) => parsed(s.text, s.text.includes(" are ") ? 2 : 1),
        }).analyze("They is more better and most best.");
        expect(report.diagnostics.find((d) => d.ruleId === "agreement")!.proposals).toEqual([]);
    });

    it("rejects a newly located finding even when the rule count stays unchanged", async () => {
        const report = await pipeline({
            sentence: async (s) => {
                const result = parsed(s.text, 2);
                return {
                    ...result,
                    graph: [result.graph[s.text.includes(" are ") ? 1 : 0]!],
                };
            },
        }).analyze("They is more better and most best.");
        expect(report.diagnostics.find((d) => d.ruleId === "agreement")!.proposals).toEqual([]);
    });

    it("withholds a repair when the contextual classifier detects a new supported issue", async () => {
        const classify = async (s: Sentence): Promise<Diagnostic[]> =>
            s.text.includes(" are ")
                ? [
                      finding(
                          s,
                          "model-agreement",
                          "agreement",
                          s.tokens[1]!,
                          "Grammar",
                          "Controlled classifier finding",
                          "The test classifier reports an issue only after the candidate edit.",
                          [],
                          "Possible issue",
                      ),
                  ]
                : [];
        const report = await pipeline({ classify }).analyze("They is ready.");
        expect(report.diagnostics.find((d) => d.ruleId === "agreement")!.proposals).toEqual([]);
    });

    it("retains a safe bounded repair and its original document offsets", async () => {
        const text = "Students are ready.\n\nThey is ready.";
        const report = await pipeline().analyze(text);
        const issue = report.diagnostics.find((d) => d.ruleId === "agreement")!;
        expect(issue.proposals).toHaveLength(1);
        expect(issue.proposals[0]!.validation?.status).toBe("rechecked");
        expect(EssayDocument.create(text).apply(issue.proposals[0]!).text).toBe(
            "Students are ready.\n\nThey are ready.",
        );
    });

    it("preserves supported lexical repairs beyond the neural token limit", async () => {
        const text = `They is ready ${Array.from({ length: 135 }, () => "today").join(" ")}.`;
        const report = await pipeline({
            // The production runtime preserves the supplied lexical parse above its limit.
            sentence: async (s) => (s.tokens.length > 128 ? s : parsed(s.text)),
        }).analyze(text);
        const issue = report.diagnostics.find((d) => d.ruleId === "agreement")!;
        expect(issue.proposals).toHaveLength(1);
        expect(EssayDocument.create(text).apply(issue.proposals[0]!).text).toBe(
            text.replace("They is", "They are"),
        );
    });
});
