import { describe, expect, it } from "vitest";
import type { Morphology, Sentence } from "../src/domain";
import { createAdvancedRules } from "../src/advanced-grammar";
import { PastParticipleInflections, PresentVerbInflections } from "../src/inflections";
import { MorphologyAnalyzer, Tokenizer } from "../src/text";

const lexicon: Record<string, Morphology[]> = {
    can: [
        {
            lemma: "can",
            pos: "AUX",
            finite: true,
            verbForm: "Fin",
            udFeatures: { VerbForm: "Fin", Mood: "Ind", Tense: "Pres" },
        },
    ],
    walk: [
        {
            lemma: "walk",
            pos: "VERB",
            finite: false,
            verbForm: "Inf",
            udFeatures: { VerbForm: "Inf" },
        },
    ],
    walks: [
        {
            lemma: "walk",
            pos: "VERB",
            finite: true,
            verbForm: "Fin",
            tense: "Pres",
            number: "singular",
            person: 3,
            udFeatures: { VerbForm: "Fin", Mood: "Ind", Tense: "Pres", Number: "Sing" },
        },
    ],
    cut: [
        {
            lemma: "cut",
            pos: "VERB",
            finite: false,
            verbForm: "Inf",
            udFeatures: { VerbForm: "Inf" },
        },
        {
            lemma: "cut",
            pos: "VERB",
            finite: true,
            verbForm: "Fin",
            tense: "Past",
            udFeatures: { VerbForm: "Fin", Tense: "Past" },
        },
    ],
    go: [
        {
            lemma: "go",
            pos: "VERB",
            finite: false,
            verbForm: "Inf",
            udFeatures: { VerbForm: "Inf" },
        },
        { lemma: "_", pos: "VERB", udFeatures: {} },
    ],
    went: [
        {
            lemma: "go",
            pos: "VERB",
            finite: true,
            verbForm: "Fin",
            tense: "Past",
            udFeatures: { VerbForm: "Fin", Tense: "Past" },
        },
        { lemma: "_", pos: "VERB", udFeatures: {} },
    ],
    gone: [
        {
            lemma: "go",
            pos: "VERB",
            finite: false,
            verbForm: "Part",
            tense: "Past",
            udFeatures: { VerbForm: "Part", Tense: "Past" },
        },
    ],
    have: [
        {
            lemma: "have",
            pos: "AUX",
            finite: false,
            verbForm: "Inf",
            udFeatures: { VerbForm: "Inf" },
        },
    ],
    will: [{ lemma: "will", pos: "AUX", finite: true, verbForm: "Fin", tense: "Pres" }],
    be: [{ lemma: "be", pos: "AUX", finite: false, verbForm: "Inf" }],
    examine: [{ lemma: "examine", pos: "VERB", finite: false, verbForm: "Inf" }],
    examined: [{ lemma: "examine", pos: "VERB", finite: false, verbForm: "Part", tense: "Past" }],
    been: [{ lemma: "be", pos: "AUX", finite: false, verbForm: "Part", tense: "Past" }],
    has: [
        {
            lemma: "have",
            pos: "AUX",
            finite: true,
            verbForm: "Fin",
            tense: "Pres",
            number: "singular",
            person: 3,
            udFeatures: {
                VerbForm: "Fin",
                Mood: "Ind",
                Tense: "Pres",
                Number: "Sing",
                Person: "3",
            },
        },
    ],
    was: [{ lemma: "be", pos: "AUX", finite: true, verbForm: "Fin", tense: "Past" }],
};

function sentence(text: string, edges: readonly (readonly [string, string, string])[]): Sentence {
    const tokens = new Tokenizer().tokenize(text).map((token) => {
        const analyses = lexicon[token.text.toLowerCase()];
        return analyses ? { ...token, pos: analyses[0]!.pos, analyses } : token;
    });
    const index = (word: string) => {
        const result = tokens.findIndex((token) => token.text.toLowerCase() === word.toLowerCase());
        if (result < 0) throw new Error(`Missing token ${word}`);
        return result;
    };
    return {
        id: "model-feature-fixture",
        start: 0,
        end: text.length,
        text,
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

const rules = createAdvancedRules(
    new PresentVerbInflections(lexicon),
    new PastParticipleInflections(lexicon),
);

describe("corpus-derived verb-form identification", () => {
    it("ignores corpus placeholder lemmas while retaining observed morphology", () => {
        const morphology = new MorphologyAnalyzer(lexicon);
        expect(morphology.analyze("went")).toEqual([
            expect.objectContaining({
                lemma: "go",
                pos: "VERB",
                udFeatures: { VerbForm: "Fin", Tense: "Past" },
            }),
        ]);
        const went = new Tokenizer(morphology).tokenize("went")[0]!;
        expect(new PastParticipleInflections(lexicon).baseForm(went)).toBe("go");
    });

    it.each([
        ["She can walks.", "walks", "walk"],
        ["She could went home.", "went", "go"],
    ])("identifies an attested non-base form after a modal in %s", (text, source, target) => {
        const tokens = text.toLowerCase().startsWith("she could")
            ? ([
                  ["went", "went", "root"],
                  ["went", "She", "nsubj"],
                  ["went", "could", "aux"],
              ] as const)
            : ([
                  ["walks", "walks", "root"],
                  ["walks", "She", "nsubj"],
                  ["walks", "can", "aux"],
              ] as const);
        const issue = rules
            .flatMap((rule) => rule.evaluate(sentence(text, tokens)))
            .find((diagnostic) => diagnostic.ruleId === "neural-modal-form");
        expect(issue?.start).toBe(text.indexOf(source!));
        expect(issue?.proposals.map((proposal) => proposal.edits[0]?.replacement)).toEqual([
            target,
        ]);
        expect(issue?.certainty).toBe("Possible issue");
    });

    it("accepts an attested infinitive and abstains on unsupported or ambiguous paradigms", () => {
        const correct = sentence("She can walk.", [
            ["walk", "walk", "root"],
            ["walk", "She", "nsubj"],
            ["walk", "can", "aux"],
        ]);
        const supported = rules
            .flatMap((rule) => rule.evaluate(correct))
            .filter((diagnostic) => diagnostic.ruleId === "neural-modal-form");
        expect(supported).toEqual([]);

        const unknown = sentence("She can teleport.", [
            ["teleport", "teleport", "root"],
            ["teleport", "She", "nsubj"],
            ["teleport", "can", "aux"],
        ]);
        expect(
            rules
                .flatMap((rule) => rule.evaluate(unknown))
                .filter((diagnostic) => diagnostic.ruleId === "neural-modal-form"),
        ).toEqual([]);

        const parsed = sentence("She can walks.", [
            ["walks", "walks", "root"],
            ["walks", "She", "nsubj"],
            ["walks", "can", "aux"],
        ]);
        const ambiguous = { ...parsed, ambiguous: true };
        expect(
            rules
                .flatMap((rule) => rule.evaluate(ambiguous))
                .filter((diagnostic) => diagnostic.ruleId === "neural-modal-form"),
        ).toEqual([]);

        const syncretic = sentence("She can cut paper.", [
            ["cut", "cut", "root"],
            ["cut", "She", "nsubj"],
            ["cut", "can", "aux"],
        ]);
        expect(
            rules
                .flatMap((rule) => rule.evaluate(syncretic))
                .filter((diagnostic) => diagnostic.ruleId === "neural-modal-form"),
        ).toEqual([]);
    });

    it("trusts the selected parse over distant beam alternatives but checks competitive parses", () => {
        const parsed = sentence("She could went home.", [
            ["went", "went", "root"],
            ["went", "She", "nsubj"],
            ["went", "could", "aux"],
        ]);
        const distantAlternative = {
            graph: parsed.graph.filter((edge) => edge.relation !== "aux"),
            score: -5,
        };
        const distant = {
            ...parsed,
            alternatives: [{ graph: parsed.graph, score: 0 }, distantAlternative],
        };
        const near = {
            ...parsed,
            alternatives: [
                { graph: parsed.graph, score: 0 },
                { ...distantAlternative, score: -0.5 },
            ],
        };
        const modalFindings = (value: Sentence) =>
            rules
                .flatMap((rule) => rule.evaluate(value))
                .filter((diagnostic) => diagnostic.ruleId === "neural-modal-form");

        expect(modalFindings(distant)).toHaveLength(1);
        expect(modalFindings(near)).toEqual([]);
    });

    it("checks passive participles and preserves valid progressive forms", () => {
        const passive = sentence("They was went home.", [
            ["went", "went", "root"],
            ["went", "They", "nsubj:pass"],
            ["went", "was", "aux:pass"],
        ]);
        const participle = rules
            .flatMap((rule) => rule.evaluate(passive))
            .find((diagnostic) => diagnostic.ruleId === "neural-perfect-form");
        expect(participle?.proposals[0]?.edits[0]?.replacement).toBe("gone");

        const progressive = sentence("They were going home.", [
            ["going", "going", "root"],
            ["going", "They", "nsubj"],
            ["going", "were", "aux"],
        ]);
        expect(
            rules
                .flatMap((rule) => rule.evaluate(progressive))
                .filter((diagnostic) => diagnostic.ruleId === "neural-perfect-form"),
        ).toEqual([]);
    });

    it("keeps passive participles out of the modal base-form check", () => {
        const passive = sentence("They will be examined.", [
            ["examined", "examined", "root"],
            ["examined", "They", "nsubj:pass"],
            ["examined", "will", "aux"],
            ["examined", "be", "aux:pass"],
        ]);
        const findings = rules.flatMap((rule) => rule.evaluate(passive));
        expect(findings.filter((diagnostic) => diagnostic.ruleId === "neural-modal-form")).toEqual(
            [],
        );
        const unstablePassiveAuxiliary = {
            ...passive,
            alternatives: [
                { graph: passive.graph, score: 0 },
                {
                    graph: passive.graph.filter(
                        (edge) => passive.tokens[edge.dependent]?.text !== "be",
                    ),
                    score: -0.2,
                },
            ],
        };
        expect(
            rules
                .flatMap((rule) => rule.evaluate(unstablePassiveAuxiliary))
                .filter((diagnostic) => diagnostic.ruleId === "neural-modal-form"),
        ).toEqual([]);

        const malformedPassive = sentence("They will be examine.", [
            ["examine", "examine", "root"],
            ["examine", "They", "nsubj:pass"],
            ["examine", "will", "aux"],
            ["examine", "be", "aux:pass"],
        ]);
        const participleFinding = rules
            .flatMap((rule) => rule.evaluate(malformedPassive))
            .find((diagnostic) => diagnostic.ruleId === "neural-perfect-form");
        expect(participleFinding?.proposals[0]?.edits[0]?.replacement).toBe("examined");
    });

    it("routes a modal-perfect lexical error to the participle rule", () => {
        const malformedPerfect = sentence("She could have went home.", [
            ["went", "went", "root"],
            ["went", "She", "nsubj"],
            ["went", "could", "aux"],
            ["went", "have", "aux"],
        ]);
        const findings = rules.flatMap((rule) => rule.evaluate(malformedPerfect));
        expect(findings.filter((diagnostic) => diagnostic.ruleId === "neural-modal-form")).toEqual(
            [],
        );
        const participleFinding = findings.find(
            (diagnostic) => diagnostic.ruleId === "neural-perfect-form",
        );
        expect(participleFinding?.proposals[0]?.edits[0]?.replacement).toBe("gone");
    });

    it("preserves full UD morphology on model analyses for downstream rules", () => {
        const analyzed = sentence("She can walks.", [
            ["walks", "walks", "root"],
            ["walks", "She", "nsubj"],
            ["walks", "can", "aux"],
        ]);
        expect(
            analyzed.tokens.find((token) => token.text === "walks")?.analyses[0]?.udFeatures,
        ).toEqual({
            VerbForm: "Fin",
            Mood: "Ind",
            Tense: "Pres",
            Number: "Sing",
        });
    });
});
