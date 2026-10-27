import { describe, expect, it } from "vitest";
import { advancedRules, createAdvancedRules } from "../src/advanced-grammar";
import { EssayDocument, type Morphology, type Sentence } from "../src/domain";
import { DiagnosticResolver, GrammarConstraintEngine, rules as baseRules } from "../src/grammar";
import { CountNounInflections, PresentVerbInflections } from "../src/inflections";
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
    enjoy: verb("enjoy"),
    avoid: verb("avoid"),
    want: verb("want"),
    write: { lemma: "write", pos: "VERB", finite: false, verbForm: "Inf" },
    writing: { lemma: "write", pos: "VERB", finite: false, verbForm: "Part" },
    arrived: verb("arrive"),
    departed: verb("depart"),
    shouted: verb("shout"),
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
    one: { lemma: "one", pos: "NUM", number: "singular" },
    zero: { lemma: "zero", pos: "NUM" },
    two: { lemma: "two", pos: "NUM" },
    three: { lemma: "three", pos: "NUM" },
    "430": { lemma: "430", pos: "NUM" },
    many: { lemma: "many", pos: "DET" },
    a: { lemma: "a", pos: "DET" },
    dog: { lemma: "dog", pos: "NOUN", number: "singular" },
    dogs: { lemma: "dog", pos: "NOUN", number: "plural" },
    call: { lemma: "call", pos: "NOUN", number: "singular" },
    calls: { lemma: "call", pos: "NOUN", number: "plural" },
    sheep: { lemma: "sheep", pos: "NOUN", number: "singular" },
    toys: { lemma: "toy", pos: "NOUN", number: "plural" },
    water: { lemma: "water", pos: "NOUN", number: "singular" },
};
function parsed(
    text: string,
    edges: readonly Edge[],
    offset = 0,
    extraForms: Readonly<Record<string, Morphology>> = {},
): Sentence {
    const tokens = new Tokenizer().tokenize(text, offset).map((token) => {
        const form = extraForms[token.text.toLowerCase()] ?? forms[token.text.toLowerCase()];
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
const nounNumberIssues = (sentence: Sentence) => countNounRule.evaluate(sentence);
const countNounForms = {
    dog: [forms.dog!],
    dogs: [forms.dogs!],
    call: [forms.call!],
    calls: [forms.calls!],
    water: [forms.water!],
};
const countNounRule = createAdvancedRules(
    new PresentVerbInflections({}),
    undefined,
    new CountNounInflections(countNounForms),
).find((rule) => rule.id === "count-noun-number")!;
const clauses = (relation = "parataxis"): Edge[] => [
    ["arrived", "arrived", "root"],
    ["arrived", "courier", "nsubj"],
    ["arrived", "departed", relation],
    ["departed", "driver", "nsubj"],
];

describe("parsed coordinated-subject agreement", () => {
    const observed = {
        walk: [
            {
                lemma: "walk",
                pos: "VERB" as const,
                number: "plural" as const,
                finite: true,
                verbForm: "Fin",
                tense: "Pres",
            },
        ],
        walks: [
            {
                lemma: "walk",
                pos: "VERB" as const,
                number: "singular" as const,
                person: 3 as const,
                finite: true,
                verbForm: "Fin",
                tense: "Pres",
            },
        ],
    };
    const agreement = new GrammarConstraintEngine(
        createAdvancedRules(new PresentVerbInflections(observed)),
    );
    const tokenForms = Object.fromEntries(
        Object.entries(observed).map(([word, analyses]) => [word, analyses[0]!]),
    );
    const edges: Edge[] = [
        ["walks", "walks", "root"],
        ["walks", "student", "nsubj"],
        ["student", "teacher", "conj"],
        ["teacher", "and", "cc"],
        ["student", "the", "det"],
        ["teacher", "the", "det"],
    ];

    it("uses plural agreement for an unambiguous and-coordinated subject", () => {
        const sentence = parsed("The student and the teacher walks home.", edges, 0, tokenForms);
        const issue = agreement
            .evaluate(sentence)
            .find((item) => item.ruleId === "neural-agreement");
        expect(issue?.proposals[0]?.edits[0]?.replacement).toBe("walk");
        expect(issue?.evidence.map((evidence) => evidence.label)).toContain(
            "Parsed grammatical subject",
        );
    });

    it("does not treat a relative that as an agreement subject", () => {
        const sentence = parsed("The books that are interesting.", [["are", "that", "nsubj"]], 0, {
            that: { lemma: "that", pos: "PRON" as const, number: "singular" as const },
            are: {
                lemma: "be",
                pos: "AUX" as const,
                finite: true,
                verbForm: "Fin" as const,
                tense: "Pres" as const,
                number: "plural" as const,
            },
            books: { lemma: "book", pos: "NOUN" as const, number: "plural" as const },
            interesting: { lemma: "interesting", pos: "ADJ" as const },
        });
        expect(
            agreement.evaluate(sentence).filter((item) => item.ruleId === "neural-agreement"),
        ).toEqual([]);
    });

    it.each([
        ["The student and the teacher walk home.", "and", "walk"],
        ["The student or the teacher walks home.", "or", "walks"],
    ])(
        "leaves valid agreement or alternative coordination unchanged: %s",
        (text, coordinator, verb) => {
            const parsedEdges: Edge[] = edges.map(([head, dependent, relation]) => [
                head === "walks" ? verb! : head,
                relation === "cc" ? coordinator! : dependent === "walks" ? verb! : dependent,
                relation,
            ]);
            const sentence = parsed(text, parsedEdges, 0, {
                ...tokenForms,
            });
            expect(sentence.tokens.some((token) => token.text === verb)).toBe(true);
            expect(
                agreement.evaluate(sentence).filter((item) => item.ruleId === "neural-agreement"),
            ).toEqual([]);
        },
    );
});

describe("parsed gerund complement reviews", () => {
    const rule = advancedRules.find((candidate) => candidate.id === "gerund-complement")!;
    const complement = (text = "We enjoy to write.", governor = "enjoy", offset = 0) =>
        parsed(
            text,
            [
                [governor, governor, "root"],
                [governor, "We", "nsubj"],
                [governor, "write", "xcomp"],
                ["write", "to", "mark"],
            ],
            offset,
        );

    it.each(["enjoy", "avoid"])("reviews a direct to-infinitive after %s", (governor) => {
        const sentence = complement(`We ${governor} to write.`, governor, 30);
        const [issue] = rule.evaluate(sentence);
        expect(issue).toMatchObject({
            ruleId: "gerund-complement",
            certainty: "Possible issue",
            proposals: [],
            confidence: { calibrated: false },
        });
        expect(
            sentence.text.slice(issue!.start - sentence.start, issue!.end - sentence.start),
        ).toBe("to write");
        expect(issue!.evidence.map((e) => e.label)).toEqual([
            "Governing verb",
            "Parsed infinitive complement",
        ]);
        expect(
            createAdvancedRules(new PresentVerbInflections({})).some(
                (candidate) => candidate.id === rule.id,
            ),
        ).toBe(true);
    });

    it("accepts a gerund complement and verbs that license an infinitive", () => {
        expect(rule.evaluate(parsed("We enjoy writing.", [["enjoy", "writing", "xcomp"]]))).toEqual(
            [],
        );
        expect(rule.evaluate(complement("We want to write.", "want"))).toEqual([]);
    });

    it("abstains on quoted text, recovery syntax, and ambiguous parses", () => {
        const sentence = complement();
        expect(rule.evaluate(complement('"We enjoy to write."'))).toEqual([]);
        expect(rule.evaluate({ ...sentence, syntaxSource: "lexical" })).toEqual([]);
        expect(rule.evaluate({ ...sentence, ambiguous: true })).toEqual([]);
    });

    it.each(["xcomp", "mark"])("requires beam agreement on the %s edge", (relation) => {
        const sentence = complement();
        expect(
            rule.evaluate({
                ...sentence,
                alternatives: [
                    {
                        graph: sentence.graph.filter((edge) => edge.relation !== relation),
                        score: 0,
                    },
                ],
            }),
        ).toEqual([]);
    });

    it("does not confuse purpose adjuncts or intervening objects with direct complements", () => {
        const sentence = complement();
        expect(
            rule.evaluate({
                ...sentence,
                graph: sentence.graph.map((edge) =>
                    edge.relation === "xcomp" ? { ...edge, relation: "advcl" } : edge,
                ),
            }),
        ).toEqual([]);
        expect(rule.evaluate(complement("We enjoy music to write."))).toEqual([]);
        expect(rule.evaluate(complement("We enjoy, to write."))).toEqual([]);
    });

    it("abstains on an independent complement subject or competing verb morphology", () => {
        const sentence = complement();
        expect(
            rule.evaluate({
                ...sentence,
                graph: [...sentence.graph, { head: 3, dependent: 0, relation: "nsubj" }],
            }),
        ).toEqual([]);
        for (const form of [
            { lemma: "write", pos: "VERB", verbForm: "Part" },
            { lemma: "writ", pos: "VERB", verbForm: "Inf" },
        ] as Morphology[]) {
            expect(
                rule.evaluate({
                    ...sentence,
                    tokens: sentence.tokens.map((token) =>
                        token.text === "write"
                            ? { ...token, analyses: [...token.analyses, form] }
                            : token,
                    ),
                }),
            ).toEqual([]);
        }
    });
});

describe("parsed count-noun number reviews", () => {
    const quantity = (text: string, number: string, noun: string, relation = "nummod") =>
        parsed(text, [
            [noun, noun, "root"],
            [noun, number, relation],
        ]);

    it.each([
        ["We saw three dog.", "three", "dog"],
        ["We saw 3 dog.", "3", "dog"],
        ["We saw zero dog.", "zero", "dog"],
        ["We saw many dog.", "many", "dog", "det"],
    ])("reviews a parsed singular count noun after a plural quantity: %s", (...values) => {
        const [text, number, noun, relation] = values as [string, string, string, string?];
        const sentence = quantity(text, number, noun, relation);
        const issue = nounNumberIssues(sentence)[0]!;
        expect(issue.title).toBe("Review the noun form after a plural quantity");
        expect(issue.proposals).toEqual([]);
        expect(issue.evidence.map(({ label }) => label)).toEqual([
            "Plural quantity",
            "Parsed count noun",
        ]);
        expect(issue.confidence.calibrated).toBe(false);
    });

    it.each([
        ["We saw one dog.", "one", "dog"],
        ["We saw two dogs.", "two", "dogs"],
    ])("accepts an aligned quantity and count noun: %s", (text, number, noun) => {
        expect(nounNumberIssues(quantity(text!, number!, noun!))).toEqual([]);
    });

    it("does not treat a singular noun used as a compound modifier as the counted head", () => {
        const sentence = parsed("We bought three dog toys.", [
            ["toys", "toys", "root"],
            ["toys", "dog", "compound"],
            ["dog", "three", "nummod"],
        ]);
        expect(nounNumberIssues(sentence)).toEqual([]);
    });

    it("does not read an identifier or scheduled time as a plural count", () => {
        const sentence = parsed("They scheduled a 430 call.", [
            ["call", "call", "root"],
            ["call", "430", "nummod"],
            ["call", "a", "det"],
        ]);
        expect(nounNumberIssues(sentence)).toEqual([]);
    });

    it("uses noun paradigms learned from the training lexicon to exclude mass nouns", () => {
        expect(nounNumberIssues(quantity("We need many water.", "many", "water", "det"))).toEqual(
            [],
        );
    });

    it("abstains when number morphology or the parsed quantifier attachment is ambiguous", () => {
        const sheep = quantity("We saw two sheep.", "two", "sheep");
        const ambiguousSheep: Sentence = {
            ...sheep,
            tokens: sheep.tokens.map((token) =>
                token.text === "sheep"
                    ? {
                          ...token,
                          analyses: [
                              { lemma: "sheep", pos: "NOUN", number: "singular" },
                              { lemma: "sheep", pos: "NOUN", number: "plural" },
                          ],
                      }
                    : token,
            ),
        };
        const ordinary = quantity("We saw three dog.", "three", "dog");
        expect(nounNumberIssues(ambiguousSheep)).toEqual([]);
        expect(nounNumberIssues({ ...ordinary, ambiguous: true })).toEqual([]);
        expect(
            nounNumberIssues({
                ...ordinary,
                alternatives: [
                    {
                        graph: ordinary.graph.filter((edge) => edge.relation !== "nummod"),
                        score: 0,
                    },
                ],
            }),
        ).toEqual([]);
    });
});

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

    it("keeps comma-splice evidence ordered when the second clause is inverted", () => {
        const text = "We arrived, shouted the neighbors.";
        const sentence = parsed(text, [
            ["arrived", "We", "nsubj"],
            ["arrived", "shouted", "conj"],
            ["shouted", "neighbors", "nsubj"],
            ["neighbors", "the", "det"],
        ]);
        const finding = issues(sentence).find((issue) => issue.ruleId === "comma-splice");
        expect(finding).toBeDefined();
        for (const evidence of finding!.evidence) {
            expect(evidence.start).toBeGreaterThanOrEqual(0);
            expect(evidence.start).toBeLessThanOrEqual(evidence.end);
            expect(evidence.end).toBeLessThanOrEqual(text.length);
            expect(text.slice(evidence.start, evidence.end).length).toBeGreaterThan(0);
        }
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

    it("does not treat a temporal that-phrase as a subordinate clause", () => {
        const forms = {
            since: { lemma: "since", pos: "SCONJ" as const },
            that: { lemma: "that", pos: "DET" as const },
            time: { lemma: "time", pos: "NOUN" as const, number: "singular" as const },
            people: { lemma: "people", pos: "NOUN" as const, number: "plural" as const },
            changed: {
                lemma: "change",
                pos: "VERB" as const,
                finite: true,
                verbForm: "Fin" as const,
                tense: "Past" as const,
            },
        };
        expect(
            issues(
                parsed(
                    "Since that time people changed.",
                    [
                        ["changed", "changed", "root"],
                        ["changed", "people", "nsubj"],
                        ["changed", "Since", "mark"],
                    ],
                    0,
                    forms,
                ),
            ),
        ).toEqual([]);
        const afterForms = {
            ...forms,
            after: { lemma: "after", pos: "SCONJ" as const },
            his: { lemma: "his", pos: "DET" as const },
            family: {
                lemma: "family",
                pos: "NOUN" as const,
                number: "singular" as const,
            },
            left: {
                lemma: "leave",
                pos: "VERB" as const,
                finite: true,
                verbForm: "Fin" as const,
                tense: "Past" as const,
            },
        };
        expect(
            issues(
                parsed(
                    "After that his family left.",
                    [
                        ["left", "left", "root"],
                        ["left", "family", "nsubj"],
                        ["left", "After", "mark"],
                    ],
                    0,
                    afterForms,
                ),
            ),
        ).toEqual([]);
    });

    it("keeps a double determiner after that as a fragment error", () => {
        const result = issues(
            parsed(
                "Since that the plot changed.",
                [
                    ["changed", "changed", "root"],
                    ["changed", "plot", "nsubj"],
                    ["changed", "Since", "mark"],
                ],
                0,
                {
                    since: { lemma: "since", pos: "SCONJ" as const },
                    that: { lemma: "that", pos: "DET" as const },
                    the: { lemma: "the", pos: "DET" as const },
                    plot: { lemma: "plot", pos: "NOUN" as const, number: "singular" as const },
                    changed: {
                        lemma: "change",
                        pos: "VERB" as const,
                        finite: true,
                        verbForm: "Fin" as const,
                        tense: "Past" as const,
                    },
                },
            ),
        );
        expect(result).toHaveLength(1);
        expect(result[0]?.ruleId).toBe("dependent-fragment");
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
