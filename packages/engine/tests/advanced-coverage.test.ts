import { describe, expect, it } from "vitest";
import { advancedRules } from "../src/advanced-grammar";
import { EssayDocument, type Morphology, type Sentence } from "../src/domain";
import { DiagnosticResolver, GrammarConstraintEngine, rules as baseRules } from "../src/grammar";
import { createPipeline } from "../src/pipeline";
import { Tokenizer } from "../src/text";

type Edge = readonly [string, string, string];
const verb = (lemma: string): Morphology => ({
    lemma,
    pos: "VERB",
    finite: true,
    verbForm: "Fin",
});
const forms: Record<string, Morphology> = {
    arrived: verb("arrive"),
    departed: verb("depart"),
    stopped: verb("stop"),
    left: verb("leave"),
    ready: { lemma: "ready", pos: "ADJ" },
    late: { lemma: "late", pos: "ADJ" },
    was: { lemma: "be", pos: "AUX", finite: true, verbForm: "Fin" },
    had: { lemma: "have", pos: "AUX", finite: true, verbForm: "Fin" },
    waiting: { lemma: "wait", pos: "VERB", finite: false, verbForm: "Part" },
    gone: { lemma: "go", pos: "VERB", finite: false, verbForm: "Part" },
    however: { lemma: "however", pos: "ADV" },
    damaged: { lemma: "damage", pos: "VERB", finite: false, verbForm: "Part", tense: "Past" },
    repaired: { lemma: "repair", pos: "VERB", finite: false, verbForm: "Part", tense: "Past" },
};
function parsed(text: string, edges: readonly Edge[], offset = 0): Sentence {
    const tokens = new Tokenizer().tokenize(text, offset).map((token) => {
        const form = forms[token.text.toLowerCase()];
        return form ? { ...token, pos: form.pos, analyses: [form] } : token;
    });
    const index = (word: string) => {
        const result = tokens.findIndex((token) => token.text.toLowerCase() === word.toLowerCase());
        if (result < 0) throw new Error(`Missing fixture word: ${word}`);
        return result;
    };
    return {
        id: "boundary-fixture",
        text,
        start: offset,
        end: offset + text.length,
        tokens,
        graph: edges.map(([head, dependent, relation]) => ({
            head: index(head),
            dependent: index(dependent),
            relation,
        })),
        ambiguous: false,
        syntaxSource: "neural",
    };
}
const engine = new GrammarConstraintEngine(advancedRules);
const issues = (sentence: Sentence) =>
    engine
        .evaluate(sentence)
        .filter((issue) => ["comma-splice", "run-on", "dependent-fragment"].includes(issue.ruleId));
const seriesIssues = (sentence: Sentence) =>
    advancedRules
        .flatMap((rule) => rule.evaluate(sentence))
        .filter((issue) => issue.ruleId === "missing-series-comma");
const clauses = (relation = "parataxis"): Edge[] => [
    ["arrived", "arrived", "root"],
    ["arrived", "courier", "nsubj"],
    ["arrived", "departed", relation],
    ["departed", "driver", "nsubj"],
];

describe("parsed list punctuation", () => {
    const list = (text: string) =>
        parsed(text, [
            ["packed", "packed", "root"],
            ["packed", "We", "nsubj"],
            ["packed", "bread", "obj"],
            ["bread", "fruit", "conj"],
            ["bread", "water", "conj"],
            ["water", "and", "cc"],
        ]);

    it("suggests a missing separator between early items in a parsed three-item list", () => {
        const text = "We packed bread fruit and water.";
        const issue = seriesIssues(list(text))[0]!;

        expect(issue.ruleId).toBe("missing-series-comma");
        expect(EssayDocument.create(text).apply(issue.proposals[0]!).text).toBe(
            "We packed bread, fruit and water.",
        );
    });

    it.each(["We packed bread, fruit, and water.", "We packed bread, fruit and water."])(
        "accepts complete or style-variable list punctuation: %s",
        (text) => {
            expect(seriesIssues(list(text))).toEqual([]);
        },
    );

    it("does not treat two coordinated items as a series", () => {
        expect(
            seriesIssues(
                parsed("We packed bread and water.", [
                    ["packed", "packed", "root"],
                    ["packed", "We", "nsubj"],
                    ["packed", "bread", "obj"],
                    ["bread", "water", "conj"],
                    ["water", "and", "cc"],
                ]),
            ),
        ).toEqual([]);
    });

    it("abstains when the syntax parse is ambiguous", () => {
        const sentence = list("We packed bread fruit and water.");
        expect(seriesIssues({ ...sentence, ambiguous: true })).toEqual([]);
    });
});

describe("finite independent clause boundary coverage", () => {
    it("detects pronoun-subject comma splices through the ordinary analysis pipeline", () => {
        const text = "I work hard, she studies daily.";
        const report = createPipeline().analyze(text);
        expect(report.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain("comma-splice");
        expect(createPipeline().analyze("I work hard, and she studies daily.").diagnostics).toEqual(
            [],
        );
    });

    it("uses tensed subjects when a transition parse mislabels a complete clause as subordinate", () => {
        const sentence = parsed("The storm damaged the lighthouse, the keeper repaired the lamp.", [
            ["repaired", "repaired", "root"],
            ["repaired", "keeper", "nsubj"],
            ["repaired", "damaged", "advcl"],
            ["damaged", "storm", "nsubj"],
        ]);
        expect(issues(sentence).map((issue) => issue.ruleId)).toContain("comma-splice");
    });

    it("keeps a marked introductory subordinate clause as a valid control", () => {
        const sentence = parsed(
            "When the storm damaged the lighthouse, the keeper repaired the lamp.",
            [
                ["repaired", "repaired", "root"],
                ["repaired", "keeper", "nsubj"],
                ["repaired", "damaged", "advcl"],
                ["damaged", "storm", "nsubj"],
                ["damaged", "When", "mark"],
            ],
        );
        expect(issues(sentence)).toEqual([]);
    });

    it.each(["parataxis", "conj"])(
        "detects noun-subject comma splices parsed as %s",
        (relation) => {
            const text = "A courier arrived, the driver departed.";
            const sentence = parsed(text, [...clauses(relation), ["driver", "the", "det"]]);
            const result = issues(sentence);
            expect(result).toHaveLength(1);
            expect(result[0]?.ruleId).toBe("comma-splice");
            expect(EssayDocument.create(text).apply(result[0]!.proposals[0]!).text).toBe(
                "A courier arrived; the driver departed.",
            );
            expect(result[0]?.certainty).toBe("Possible issue");
        },
    );

    it.each(["parataxis", "conj"])("repairs full noun-phrase run-ons parsed as %s", (relation) => {
        const text = "A courier arrived the driver departed.";
        const sentence = parsed(text, [...clauses(relation), ["driver", "the", "det"]]);
        const result = issues(sentence);
        expect(result).toHaveLength(1);
        expect(result[0]?.ruleId).toBe("run-on");
        expect(EssayDocument.create(text).apply(result[0]!.proposals[0]!).text).toBe(
            "A courier arrived; the driver departed.",
        );
    });

    it("handles finite copulas on adjective heads", () => {
        const sentence = parsed("Mira was ready, he arrived.", [
            ["ready", "Mira", "nsubj"],
            ["ready", "was", "cop"],
            ["ready", "arrived", "conj"],
            ["arrived", "he", "nsubj"],
        ]);
        expect(issues(sentence).map((issue) => issue.ruleId)).toEqual(["comma-splice"]);
    });

    it("handles finite auxiliaries on nonfinite clause heads", () => {
        const sentence = parsed("Mira was waiting he had gone.", [
            ["waiting", "Mira", "nsubj"],
            ["waiting", "was", "aux"],
            ["waiting", "gone", "parataxis"],
            ["gone", "he", "nsubj"],
            ["gone", "had", "aux"],
        ]);
        expect(issues(sentence).map((issue) => issue.ruleId)).toEqual(["run-on"]);
    });

    it("places the boundary before a conjunctive adverb and keeps its comma", () => {
        const text = "A courier arrived, however, the driver departed.";
        const sentence = parsed(text, [
            ...clauses("conj"),
            ["departed", "however", "advmod"],
            ["driver", "the", "det"],
        ]);
        const issue = issues(sentence)[0]!;
        expect(EssayDocument.create(text).apply(issue.proposals[0]!).text).toBe(
            "A courier arrived; however, the driver departed.",
        );
    });

    it("preserves document offsets and Unicode while inserting a run-on repair", () => {
        const prefix = "中文 😀\n\n";
        const text = "A courier arrived the driver departed.";
        const sentence = parsed(text, [...clauses(), ["driver", "the", "det"]], prefix.length);
        const issue = issues(sentence)[0]!;
        expect(EssayDocument.create(prefix + text).apply(issue.proposals[0]!).text).toBe(
            prefix + "A courier arrived; the driver departed.",
        );
    });

    it.each([";", ":", "—", "–", ".", "!", "?"])(
        "preserves an existing %s boundary",
        (punctuation) => {
            expect(
                issues(parsed(`A courier arrived${punctuation} the driver departed.`, clauses())),
            ).toEqual([]);
        },
    );

    it.each(["and", "but", "or", "yet", "so", "for", "nor"])(
        "preserves an explicit coordinator %s",
        (word) => {
            expect(
                issues(
                    parsed(`A courier arrived, ${word} the driver departed.`, [
                        ...clauses("conj"),
                        ["departed", word, "cc"],
                    ]),
                ),
            ).toEqual([]);
        },
    );

    it("preserves subordinate clauses even with a parataxis alternative attachment", () => {
        expect(
            issues(
                parsed("A courier arrived because the driver departed.", [
                    ...clauses(),
                    ["departed", "because", "mark"],
                ]),
            ),
        ).toEqual([]);
    });

    it("does not treat clauses inside an embedded complement as independent", () => {
        expect(
            issues(
                parsed("He left when a courier arrived, the driver departed.", [
                    ...clauses("conj"),
                    ["left", "arrived", "advcl"],
                    ["arrived", "when", "mark"],
                ]),
            ),
        ).toEqual([]);
    });

    it("preserves nonfinite clauses, shared subjects, and quotation", () => {
        expect(
            issues(
                parsed("Mira waiting, he departed.", [
                    ["waiting", "Mira", "nsubj"],
                    ["waiting", "departed", "conj"],
                    ["departed", "he", "nsubj"],
                ]),
            ),
        ).toEqual([]);
        expect(
            issues(
                parsed("A courier arrived, departed.", [
                    ["arrived", "courier", "nsubj"],
                    ["arrived", "departed", "conj"],
                ]),
            ),
        ).toEqual([]);
        expect(issues(parsed("“A courier arrived, the driver departed.”", clauses()))).toEqual([]);
    });

    it("abstains on ambiguous or unstable subject, clause and auxiliary evidence", () => {
        const sentence = parsed("A courier arrived, the driver departed.", clauses());
        expect(issues({ ...sentence, ambiguous: true })).toEqual([]);
        for (const index of [1, 2, 3])
            expect(
                issues({
                    ...sentence,
                    alternatives: [
                        { graph: sentence.graph.filter((_, i) => i !== index), score: 0 },
                    ],
                }),
            ).toEqual([]);
        const copular = parsed("Mira was ready, he arrived.", [
            ["ready", "Mira", "nsubj"],
            ["ready", "was", "cop"],
            ["ready", "arrived", "conj"],
            ["arrived", "he", "nsubj"],
        ]);
        expect(
            issues({
                ...copular,
                alternatives: [
                    {
                        graph: copular.graph.filter((edge) => edge.relation !== "cop"),
                        score: 0,
                    },
                ],
            }),
        ).toEqual([]);
    });
});

describe("parsed subordinate-root fragment reviews", () => {
    const fragment = (marker: string, text = `${marker} the rain stopped.`) =>
        parsed(text, [
            ["stopped", "stopped", "root"],
            ["stopped", "rain", "nsubj"],
            ["stopped", marker, "mark"],
        ]);
    it.each([
        "Although",
        "Because",
        "Unless",
        "Whereas",
        "Though",
        "While",
        "When",
        "After",
        "Before",
        "Since",
    ])("reviews %s as a parsed dependent root without rewriting the author's intent", (marker) => {
        const result = issues(fragment(marker));
        expect(result).toHaveLength(1);
        expect(result[0]?.ruleId).toBe("dependent-fragment");
        expect(result[0]?.proposals).toEqual([]);
        expect(result[0]?.certainty).toBe("Possible issue");
    });

    it("does not mistake a following main clause for a fragment", () => {
        const sentence = fragment("When", "When the rain stopped we left.");
        const left = sentence.tokens.findIndex((token) => token.text === "left");
        const we = sentence.tokens.findIndex((token) => token.text === "we");
        expect(
            issues({
                ...sentence,
                graph: [...sentence.graph, { head: left, dependent: we, relation: "nsubj" }],
            }),
        ).toEqual([]);
    });

    it("preserves an imperative main clause without an overt subject", () => {
        const sentence = fragment("When", "When the rain stopped, leave.");
        const leave = sentence.tokens.findIndex((token) => token.text === "leave");
        const stopped = sentence.tokens.findIndex((token) => token.text === "stopped");
        expect(
            issues({
                ...sentence,
                tokens: sentence.tokens.map((token, index) =>
                    index === leave ? { ...token, pos: "VERB", analyses: [verb("leave")] } : token,
                ),
                graph: [
                    ...sentence.graph,
                    { head: stopped, dependent: leave, relation: "parataxis" },
                ],
            }),
        ).toEqual([]);
    });

    it("merges baseline and parsed reviews of the same fragment", () => {
        const diagnostics = new GrammarConstraintEngine([...baseRules, ...advancedRules]).evaluate(
            fragment("Because"),
        );
        expect(
            new DiagnosticResolver()
                .resolve(diagnostics)
                .filter((issue) => issue.ruleId === "dependent-fragment"),
        ).toHaveLength(1);
    });

    it.each(["When the rain stopped?", "“When the rain stopped.”", "When the rain stopped:"])(
        "preserves question, quotation, or heading contexts: %s",
        (text) => {
            expect(issues(fragment("When", text))).toEqual([]);
        },
    );

    it("requires a stable neural finite clause with an explicit subject and marker", () => {
        const sentence = fragment("When");
        expect(issues({ ...sentence, syntaxSource: "lexical" })).toEqual([]);
        expect(issues({ ...sentence, ambiguous: true })).toEqual([]);
        for (const relation of ["root", "mark", "nsubj"])
            expect(
                issues({
                    ...sentence,
                    graph: sentence.graph.filter((edge) => edge.relation !== relation),
                }),
            ).toEqual([]);
        expect(issues({ ...sentence, alternatives: [{ graph: [], score: 0 }] })).toEqual([]);
        expect(
            issues(
                parsed("While Mira waiting.", [
                    ["waiting", "waiting", "root"],
                    ["waiting", "Mira", "nsubj"],
                    ["waiting", "While", "mark"],
                ]),
            ),
        ).toEqual([]);
    });
});
