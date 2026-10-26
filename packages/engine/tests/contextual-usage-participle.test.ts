import { describe, expect, it } from "vitest";
import { EssayDocument, type Morphology, type Sentence } from "../src/domain";
import { GrammarConstraintEngine, rules } from "../src/grammar";
import { Tokenizer } from "../src/text";

const engine = new GrammarConstraintEngine(rules);

function sentence(
    text: string,
    forms: Readonly<Record<string, readonly Morphology[]>> = {},
): Sentence {
    const tokens = new Tokenizer().tokenize(text).map((token) => {
        const analyses = forms[token.text.toLowerCase()];
        return analyses ? { ...token, analyses, pos: analyses[0]!.pos } : token;
    });
    return {
        id: "modal-of-participle",
        text,
        start: 0,
        end: text.length,
        tokens,
        graph: [],
        ambiguous: false,
    };
}

const issues = (text: string, forms?: Readonly<Record<string, readonly Morphology[]>>) =>
    engine
        .evaluate(sentence(text, forms))
        .filter((diagnostic) => diagnostic.ruleId === "contextual-usage");

describe("modal of + unambiguous participle", () => {
    // These examples express a past possibility or counterfactual. Before the
    // morphology-backed extension, made and felt were absent from the fallback
    // list and received no finding; both now repair to modal + have + participle.
    // Purdue OWL documents the modal-have pattern and rejects modal + of:
    // https://owl.purdue.edu/owl/general_writing/grammar/verb_tenses/verbs_with_helpers.html
    it.each([
        ["They might of made a choice.", "make"],
        ["He would of felt better.", "feel"],
    ])("suggests have for a locally attested participle in %s", (text, lemma) => {
        const issue = issues(text, {
            [text.includes("made") ? "made" : "felt"]: [
                { lemma, pos: "VERB", verbForm: "Part", finite: false },
            ],
        })[0];

        expect(issue).toBeDefined();
        expect(issue!.certainty).toBe("Likely error");
        expect(text.slice(issue!.start, issue!.end)).toBe("of");
        expect(issue!.proposals[0]!.edits).toEqual([
            expect.objectContaining({
                start: issue!.start,
                end: issue!.end,
                type: "REPLACE",
                expected: "of",
                replacement: "have",
            }),
        ]);
        expect(EssayDocument.create(text).apply(issue!.proposals[0]!).text).toBe(
            text.replace(" of ", " have "),
        );
    });

    it("abstains when the next token has competing finite and participle analyses", () => {
        expect(
            issues("They might of set the record.", {
                set: [
                    { lemma: "set", pos: "VERB", verbForm: "Part", finite: false },
                    { lemma: "set", pos: "VERB", verbForm: "Fin", finite: true, tense: "Pres" },
                ],
            }),
        ).toEqual([]);
    });

    it("abstains when a candidate participle has no usable lemma", () => {
        expect(
            issues("They might of read the record.", {
                read: [{ lemma: "_", pos: "VERB", verbForm: "Part", finite: false }],
            }),
        ).toEqual([]);
    });

    it("preserves a nominal might before an ambiguous participial modifier", () => {
        expect(
            issues("The might of hidden armies was legendary.", {
                might: [
                    { lemma: "might", pos: "NOUN" },
                    { lemma: "may", pos: "AUX" },
                ],
                hidden: [
                    { lemma: "hidden", pos: "ADJ" },
                    { lemma: "hide", pos: "VERB", verbForm: "Part", finite: false },
                ],
            }),
        ).toEqual([]);
    });

    it("abstains when the selected participle competes with an adjective reading", () => {
        expect(
            issues("The might of hidden armies was legendary.", {
                might: [
                    { lemma: "may", pos: "AUX" },
                    { lemma: "might", pos: "NOUN" },
                ],
                hidden: [
                    { lemma: "hide", pos: "VERB", verbForm: "Part", finite: false },
                    { lemma: "hidden", pos: "ADJ" },
                ],
            }),
        ).toEqual([]);
    });

    it("abstains when a modal-looking word is selected as a noun", () => {
        expect(
            issues("The might of made things was legendary.", {
                might: [
                    { lemma: "might", pos: "NOUN" },
                    { lemma: "may", pos: "AUX" },
                ],
                made: [{ lemma: "make", pos: "VERB", verbForm: "Part", finite: false }],
            }),
        ).toEqual([]);
    });

    it.each([
        "She could have made a choice.",
        "She could of course have made a choice.",
        "The choice could of the committee was recorded.",
        "They said, “They might of made a choice.”",
        "They might of walking home.",
    ])("preserves a valid, quoted, or unsupported construction: %s", (text) => {
        expect(issues(text)).toEqual([]);
    });

    it("retains the reviewed fallback forms when no trained morphology is available", () => {
        const issue = issues("She could of gone home.")[0];

        expect(issue).toBeDefined();
        expect(issue!.proposals[0]!.edits[0]!.replacement).toBe("have");
    });
});
