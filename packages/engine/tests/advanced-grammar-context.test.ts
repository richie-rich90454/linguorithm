import { describe, expect, it } from "vitest";
import { advancedRules } from "../src/advanced-grammar";
import { EssayDocument, type Morphology, type Sentence } from "../src/domain";
import { GrammarConstraintEngine } from "../src/grammar";
import { Tokenizer } from "../src/text";

type Edge = readonly [string, string, string];

const tensed: Readonly<Record<string, Morphology>> = {
    arrived: { lemma: "arrive", pos: "VERB", finite: true, tense: "Past", verbForm: "Fin" },
    began: { lemma: "begin", pos: "VERB", finite: true, tense: "Past", verbForm: "Fin" },
    departed: { lemma: "depart", pos: "VERB", finite: true, tense: "Past", verbForm: "Fin" },
    know: { lemma: "know", pos: "VERB", finite: true, tense: "Pres", verbForm: "Fin" },
    left: { lemma: "leave", pos: "VERB", finite: true, tense: "Past", verbForm: "Fin" },
    rose: { lemma: "rise", pos: "VERB", finite: true, tense: "Past", verbForm: "Fin" },
    stopped: { lemma: "stop", pos: "VERB", finite: true, tense: "Past", verbForm: "Fin" },
};

function parsed(text: string, edges: readonly Edge[]): Sentence {
    const tokens = new Tokenizer().tokenize(text).map((token) => {
        const morphology = tensed[token.text.toLowerCase()];
        return morphology ? { ...token, pos: morphology.pos, analyses: [morphology] } : token;
    });
    const index = (word: string) => {
        const found = tokens.findIndex((token) => token.text.toLowerCase() === word.toLowerCase());
        if (found < 0) throw new Error(`Fixture word not found: ${word}`);
        return found;
    };
    return {
        id: "comma-context",
        text,
        start: 0,
        end: text.length,
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
const commaSplices = (sentence: Sentence) =>
    engine.evaluate(sentence).filter((diagnostic) => diagnostic.ruleId === "comma-splice");

describe("context-aware comma-splice detection", () => {
    it("does not let a subordinate marker inside an earlier complement hide a splice", () => {
        const text = "I know when you arrived, she left.";
        const result = commaSplices(
            parsed(text, [
                ["know", "know", "root"],
                ["know", "I", "nsubj"],
                ["know", "arrived", "ccomp"],
                ["arrived", "you", "nsubj"],
                ["arrived", "when", "mark"],
                ["know", "left", "parataxis"],
                ["left", "she", "nsubj"],
            ]),
        );

        expect(result).toHaveLength(1);
        expect(text.slice(result[0]!.start, result[0]!.end)).toBe(",");
        expect(result[0]!.certainty).toBe("Possible issue");
        expect(result[0]!.proposals[0]!.validation).toBeUndefined();
        expect(EssayDocument.create(text).apply(result[0]!.proposals[0]!).text).toBe(
            "I know when you arrived; she left.",
        );
    });

    it("finds independent clauses when a subject follows its finite predicate", () => {
        const text = "At noon began the meeting, the guests arrived.";
        const result = commaSplices(
            parsed(text, [
                ["began", "began", "root"],
                ["began", "meeting", "nsubj"],
                ["began", "arrived", "parataxis"],
                ["arrived", "guests", "nsubj"],
            ]),
        );

        expect(result).toHaveLength(1);
        expect(text.slice(result[0]!.start, result[0]!.end)).toBe(",");
    });

    it("preserves an introductory subordinate clause when the parse omits its marker edge", () => {
        const text = "When the storm damaged the lighthouse, the keeper repaired the lamp.";
        expect(
            commaSplices(
                parsed(text, [
                    ["damaged", "damaged", "root"],
                    ["damaged", "storm", "nsubj"],
                    ["damaged", "repaired", "parataxis"],
                    ["repaired", "keeper", "nsubj"],
                ]),
            ),
        ).toEqual([]);
    });

    it("does not let the phrase ‘as usual’ hide a comma splice", () => {
        const text = "As usual I rose early, the day was cold.";
        const result = commaSplices(
            parsed(text, [
                ["rose", "rose", "root"],
                ["rose", "I", "nsubj"],
                ["rose", "was", "parataxis"],
                ["was", "day", "nsubj"],
            ]),
        );

        expect(result).toHaveLength(1);
        expect(text.slice(result[0]!.start, result[0]!.end)).toBe(",");
    });

    it("still finds a later splice after an introductory subordinate clause", () => {
        const text =
            "When the storm damaged the lighthouse, the keeper repaired the lamp, neighbors watched.";
        const result = commaSplices(
            parsed(text, [
                ["damaged", "damaged", "root"],
                ["damaged", "storm", "nsubj"],
                ["damaged", "repaired", "parataxis"],
                ["repaired", "keeper", "nsubj"],
                ["repaired", "watched", "parataxis"],
                ["watched", "neighbors", "nsubj"],
            ]),
        );

        expect(result).toHaveLength(1);
        expect(text.slice(result[0]!.start, result[0]!.end)).toBe(",");
        expect(text.slice(result[0]!.start + 1).trimStart()).toBe("neighbors watched.");
    });

    it("reports each splice in a sentence with three independent clauses", () => {
        const text = "A courier arrived, the driver departed, the train stopped.";
        const result = commaSplices(
            parsed(text, [
                ["arrived", "arrived", "root"],
                ["arrived", "courier", "nsubj"],
                ["arrived", "departed", "parataxis"],
                ["departed", "driver", "nsubj"],
                ["departed", "stopped", "parataxis"],
                ["stopped", "train", "nsubj"],
            ]),
        );

        expect(result).toHaveLength(2);
        expect(result.map((diagnostic) => text.slice(diagnostic.start, diagnostic.end))).toEqual([
            ",",
            ",",
        ]);
        const repaired = result.reduce(
            (document, diagnostic) => document.apply(diagnostic.proposals[0]!),
            EssayDocument.create(text),
        );
        expect(repaired.text).toBe("A courier arrived; the driver departed; the train stopped.");
    });

    it.each([
        [
            "When the courier arrived, the driver departed.",
            [
                ["departed", "departed", "root"],
                ["departed", "driver", "nsubj"],
                ["departed", "arrived", "advcl"],
                ["arrived", "courier", "nsubj"],
                ["arrived", "When", "mark"],
            ] as const,
        ],
        [
            "A courier arrived, and the driver departed.",
            [
                ["arrived", "arrived", "root"],
                ["arrived", "courier", "nsubj"],
                ["arrived", "departed", "conj"],
                ["departed", "driver", "nsubj"],
                ["departed", "and", "cc"],
            ] as const,
        ],
    ])("preserves subordinate and coordinated clauses: %s", (text, edges) => {
        expect(commaSplices(parsed(text, edges))).toEqual([]);
    });

    it("abstains when the selected parse is marked ambiguous or a competitive parse differs", () => {
        const sentence = parsed("A courier arrived, the driver departed.", [
            ["arrived", "arrived", "root"],
            ["arrived", "courier", "nsubj"],
            ["arrived", "departed", "parataxis"],
            ["departed", "driver", "nsubj"],
        ]);
        expect(commaSplices({ ...sentence, ambiguous: true })).toEqual([]);
        expect(
            commaSplices({
                ...sentence,
                alternatives: [
                    {
                        score: 0,
                        graph: sentence.graph.filter((edge) => edge.relation !== "parataxis"),
                    },
                ],
            }),
        ).toEqual([]);
    });
});
