import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { advancedRules, documentRelationships } from "../src/advanced-grammar";
import { DiagnosticResolver, finding, GrammarConstraintEngine } from "../src/grammar";
import { EssayDocument, type Morphology, type Sentence } from "../src/domain";
import { createPipeline } from "../src/pipeline";
import { Tokenizer } from "../src/text";

type Edge = readonly [string, string, string];
type Forms = Record<string, Morphology>;
function parsed(text: string, edges: readonly Edge[], forms: Forms = {}, offset = 0): Sentence {
    const tokens = new Tokenizer().tokenize(text, offset).map((token) => {
        const form = forms[token.text.toLowerCase()];
        return form ? { ...token, pos: form.pos, analyses: [form] } : token;
    });
    const index = (word: string) => {
        const found = tokens.findIndex((token) => token.text.toLowerCase() === word.toLowerCase());
        if (found < 0) throw new Error(`Missing fixture token ${word}`);
        return found;
    };
    return {
        id: "fixture",
        start: offset,
        end: offset + text.length,
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
const constraints = new GrammarConstraintEngine(advancedRules);
const diagnostics = (s: Sentence, rule: string) =>
    constraints.evaluate(s).filter((d) => d.ruleId === rule);
const verb = (lemma: string): Morphology => ({ lemma, pos: "VERB", finite: true, verbForm: "Fin" });
const noun = (lemma: string, number: "singular" | "plural" = "singular"): Morphology => ({
    lemma,
    pos: "NOUN",
    number,
});

describe("finite punctuation and usage constructions", () => {
    const examples: [string, string, string][] = [
        ["That book is her's.", "possessive-apostrophe", "That book is hers."],
        ["That desk is your’s.", "possessive-apostrophe", "That desk is yours."],
        ["That book is our's.", "possessive-apostrophe", "That book is ours."],
        ["Those books are their's.", "possessive-apostrophe", "Those books are theirs."],
        [
            "The childrens' books are here.",
            "possessive-apostrophe",
            "The children's books are here.",
        ],
        ["The mens’ books are here.", "possessive-apostrophe", "The men’s books are here."],
        ["She could of gone home.", "contextual-usage", "She could have gone home."],
        ["They should of written a note.", "contextual-usage", "They should have written a note."],
        ["He is taller then me.", "contextual-usage", "He is taller than me."],
        ["It's cover is green.", "contextual-usage", "Its cover is green."],
        ["Its raining.", "contextual-usage", "It's raining."],
        ["She said, “Go”.", "quotation-punctuation", "She said, “Go.”"],
        ['She said, "Go", and left.', "quotation-punctuation", 'She said, "Go," and left.'],
    ];
    it.each(examples)(
        "repairs %s with source-matched, revalidated edits",
        (text, rule, corrected) => {
            const issue = createPipeline()
                .analyze(text)
                .diagnostics.find((d) => d.ruleId === rule);
            expect(issue).toBeDefined();
            expect(issue!.proposals[0]?.validation?.status).toBe("rechecked");
            expect(EssayDocument.create(text).apply(issue!.proposals[0]!).text).toBe(corrected);
            expect(
                createPipeline()
                    .analyze(corrected)
                    .diagnostics.filter((d) => d.ruleId === rule),
            ).toEqual([]);
        },
    );
    it.each([
        "That book is hers.",
        "The child's book is here.",
        "The children's books are here.",
        "The students' books are here.",
        "The peoples' traditions are distinct.",
        "Its cover is green.",
        "It's a book.",
        "She could have gone home.",
        "She could of course have gone home.",
        "He was taller then.",
        "He felt better then she arrived.",
        "First write, then revise.",
        "He felt better then her doctor arrived.",
        "Its raining season is brief.",
        "She said, “Go.”",
        "She asked, “Why?”",
        'The literal string is "go".',
        "She described the word “her's”.",
        "She said, “He called it 'clear'.”",
    ])("leaves valid or unsupported construction alone: %s", (text) => {
        expect(
            createPipeline()
                .analyze(text)
                .diagnostics.filter((d) =>
                    ["possessive-apostrophe", "contextual-usage", "quotation-punctuation"].includes(
                        d.ruleId,
                    ),
                ),
        ).toEqual([]);
    });
    it("preserves arbitrary Unicode surroundings while repairing a possessive", () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom("😀", "é", "中", "\r\n", " "), { maxLength: 20 }),
                (characters) => {
                    const before = characters.join("") + "\n\n",
                        text = before + "That book is her's.";
                    const issue = createPipeline()
                        .analyze(text)
                        .diagnostics.find((d) => d.ruleId === "possessive-apostrophe")!;
                    expect(issue).toBeDefined();
                    expect(EssayDocument.create(text).apply(issue.proposals[0]!).text).toBe(
                        before + "That book is hers.",
                    );
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe("parsed subject and finite agreement constraints", () => {
    it("uses the parsed subject across an intervening singular noun and a copula", () => {
        const s = parsed("The students in the laboratory is ready.", [
            ["ready", "students", "nsubj"],
            ["ready", "is", "cop"],
            ["students", "laboratory", "nmod"],
        ]);
        const issue = diagnostics(s, "neural-agreement")[0]!;
        expect(issue.proposals[0]!.edits[0]!.replacement).toBe("are");
        expect(issue.evidence[0]).toMatchObject({ start: 4, end: 12 });
        expect(issue.certainty).toBe("Possible issue");
    });
    it.each([
        ["I were ready.", "ready", "I", "were", "was"],
        ["You is ready.", "ready", "You", "is", "are"],
        ["The students walks home.", "walks", "students", "walks", "walk"],
        ["The teacher walk home.", "walk", "teacher", "walk", "walks"],
    ])(
        "supports the finite person/number construction %s",
        (text, predicate, subject, finiteWord, correction) => {
            const edges: Edge[] = [[predicate!, subject!, "nsubj"]];
            if (predicate !== finiteWord) edges.push([predicate!, finiteWord!, "cop"]);
            expect(
                diagnostics(parsed(text!, edges), "neural-agreement")[0]!.proposals[0]!.edits[0]!
                    .replacement,
            ).toBe(correction);
        },
    );
    it("does not inflect a nonfinite have under a modal", () => {
        const s = parsed("She must have gone.", [
            ["gone", "She", "nsubj"],
            ["gone", "must", "aux"],
            ["gone", "have", "aux"],
        ]);
        expect(diagnostics(s, "neural-agreement")).toEqual([]);
    });
    it("corrects the finite auxiliary without inflecting its lexical complement", () => {
        const s = parsed("She do like books.", [
            ["like", "She", "nsubj"],
            ["like", "do", "aux"],
        ]);
        const issues = diagnostics(s, "neural-agreement");
        expect(issues).toHaveLength(1);
        expect(issues[0]!.proposals[0]!.edits[0]!.replacement).toBe("does");
    });
    it("retains the mandative subjunctive", () => {
        expect(
            diagnostics(
                parsed("I suggest she go.", [
                    ["suggest", "I", "nsubj"],
                    ["suggest", "go", "ccomp"],
                    ["go", "she", "nsubj"],
                ]),
                "neural-agreement",
            ),
        ).toEqual([]);
    });
    it("abstains on quantities, coordination, alternatives and ambiguous morphology", () => {
        expect(
            diagnostics(
                parsed("A number of students are here.", [["are", "number", "nsubj"]]),
                "neural-agreement",
            ),
        ).toEqual([]);
        expect(
            diagnostics(
                parsed("The teacher and student are here.", [
                    ["are", "teacher", "nsubj"],
                    ["teacher", "student", "conj"],
                ]),
                "neural-agreement",
            ),
        ).toEqual([]);
        const s = parsed("The students is ready.", [
            ["ready", "students", "nsubj"],
            ["ready", "is", "cop"],
        ]);
        expect(diagnostics({ ...s, ambiguous: true }, "neural-agreement")).toEqual([]);
        expect(
            diagnostics({ ...s, alternatives: [{ graph: [], score: 0.9 }] }, "neural-agreement"),
        ).toEqual([]);
        expect(
            diagnostics(
                {
                    ...s,
                    tokens: s.tokens.map((t) =>
                        t.text === "students"
                            ? {
                                  ...t,
                                  analyses: [
                                      noun("student", "singular"),
                                      noun("student", "plural"),
                                  ],
                              }
                            : t,
                    ),
                },
                "neural-agreement",
            ),
        ).toEqual([]);
    });
    it("distinguishes finite subject case from licensed accusative infinitive subjects", () => {
        const direct = parsed("Him walks home.", [["walks", "Him", "nsubj"]]);
        expect(diagnostics(direct, "subject-case")[0]!.proposals[0]!.edits[0]!.replacement).toBe(
            "He",
        );
        expect(
            diagnostics(
                parsed(
                    "I saw him leave.",
                    [
                        ["saw", "I", "nsubj"],
                        ["saw", "leave", "xcomp"],
                        ["leave", "him", "nsubj"],
                    ],
                    { leave: { lemma: "leave", pos: "VERB", finite: false, verbForm: "Inf" } },
                ),
                "subject-case",
            ),
        ).toEqual([]);
    });
});

describe("clause punctuation requires a supported dependency relationship", () => {
    const openingEdges: Edge[] = [
        ["left", "stopped", "advcl"],
        ["stopped", "When", "mark"],
        ["stopped", "rain", "nsubj"],
        ["left", "we", "nsubj"],
    ];
    const openingForms = { stopped: verb("stop"), left: verb("leave") };
    it("places an introductory-clause comma at the end of the entire subordinate subtree", () => {
        const s = parsed(
            "When the rain stopped yesterday we left.",
            [...openingEdges, ["stopped", "yesterday", "advmod"]],
            openingForms,
        );
        const issue = diagnostics(s, "introductory-clause-comma")[0]!;
        expect(EssayDocument.create(s.text).apply(issue.proposals[0]!).text).toBe(
            "When the rain stopped yesterday, we left.",
        );
        expect(issue.evidence[0]!.end).toBe(s.text.indexOf(" we"));
    });
    it("does not add punctuation where a comma already separates the clauses", () => {
        expect(
            diagnostics(
                parsed("When the rain stopped, we left.", openingEdges, openingForms),
                "introductory-clause-comma",
            ),
        ).toEqual([]);
        expect(
            diagnostics(
                parsed("When the rain stopped we left.", openingEdges.slice(0, 2), openingForms),
                "introductory-clause-comma",
            ),
        ).toEqual([]);
    });
    it("reviews a colon splitting a finite verb and its listed object", () => {
        const s = parsed(
            "The kit includes: paper, pens, and ink.",
            [
                ["includes", "kit", "nsubj"],
                ["includes", "paper", "obj"],
            ],
            { includes: verb("include") },
        );
        const issue = diagnostics(s, "colon-complement")[0]!;
        expect(EssayDocument.create(s.text).apply(issue.proposals[0]!).text).toBe(
            "The kit includes paper, pens, and ink.",
        );
        expect(
            diagnostics(
                parsed(
                    "The kit includes these items: paper, pens, and ink.",
                    [
                        ["includes", "kit", "nsubj"],
                        ["includes", "items", "obj"],
                    ],
                    { includes: verb("include") },
                ),
                "colon-complement",
            ),
        ).toEqual([]);
    });
    it("distinguishes a shared predicate from two independent clauses at a semicolon", () => {
        const edges: Edge[] = [
            ["walked", "She", "nsubj"],
            ["walked", "waved", "conj"],
            ["waved", "and", "cc"],
        ];
        const forms = { walked: verb("walk"), waved: verb("wave") };
        const s = parsed("She walked; and waved.", edges, forms);
        expect(
            EssayDocument.create(s.text).apply(
                diagnostics(s, "semicolon-shared-subject")[0]!.proposals[0]!,
            ).text,
        ).toBe("She walked and waved.");
        expect(
            diagnostics(
                parsed("She walked; and he waved.", [...edges, ["waved", "he", "nsubj"]], forms),
                "semicolon-shared-subject",
            ),
        ).toEqual([]);
        expect(
            diagnostics(
                parsed("She walked, stopped; and waved.", edges, forms),
                "semicolon-shared-subject",
            ),
        ).toEqual([]);
    });
    it("keeps these structural punctuation checks out of the lexical fallback", () => {
        const s = parsed("When the rain stopped we left.", openingEdges, openingForms);
        expect(diagnostics({ ...s, syntaxSource: "lexical" }, "introductory-clause-comma")).toEqual(
            [],
        );
    });
    it("preserves structural evidence and exact edit offsets after arbitrary UTF-16 shifts", () => {
        const text = "When the rain stopped yesterday we left.";
        const edges: Edge[] = [...openingEdges, ["stopped", "yesterday", "advmod"]];
        const original = diagnostics(
            parsed(text, edges, openingForms),
            "introductory-clause-comma",
        )[0]!;
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 200 }), (length) => {
                const prefix = "😀".repeat(length),
                    fullText = prefix + text;
                const issue = diagnostics(
                    parsed(text, edges, openingForms, prefix.length),
                    "introductory-clause-comma",
                )[0]!;
                expect(issue.start).toBe(original.start + prefix.length);
                expect(issue.evidence.map((e) => fullText.slice(e.start, e.end))).toEqual(
                    original.evidence.map((e) => text.slice(e.start, e.end)),
                );
                expect(EssayDocument.create(fullText).apply(issue.proposals[0]!).text).toBe(
                    prefix + "When the rain stopped yesterday, we left.",
                );
            }),
            { numRuns: 100 },
        );
    });
});

describe("modifier, parallelism and reference evidence", () => {
    it("requires an agent-oriented participle and withholds a dangling-modifier rewrite", () => {
        const edges: Edge[] = [
            ["seemed", "Reading", "advcl"],
            ["seemed", "conclusion", "nsubj"],
        ];
        const s = parsed("Reading the report, the conclusion seemed wrong.", edges, {
            reading: { lemma: "read", pos: "VERB", finite: false, verbForm: "Part" },
        });
        const issue = diagnostics(s, "modifier-attachment")[0]!;
        expect(issue.proposals).toEqual([]);
        expect(
            diagnostics(
                { ...s, graph: [...s.graph, { head: 0, dependent: 2, relation: "nsubj" }] },
                "modifier-attachment",
            ),
        ).toEqual([]);
        expect(
            diagnostics(
                parsed(
                    "Running smoothly, the experiment succeeded.",
                    [
                        ["succeeded", "Running", "advcl"],
                        ["succeeded", "experiment", "nsubj"],
                    ],
                    { running: { lemma: "run", pos: "VERB", finite: false, verbForm: "Part" } },
                ),
                "modifier-attachment",
            ),
        ).toEqual([]);
    });
    const parallelForms = {
        enjoys: verb("enjoy"),
        reading: { lemma: "read", pos: "VERB", finite: false, verbForm: "Ger" } as Morphology,
        write: { lemma: "write", pos: "VERB", finite: false, verbForm: "Inf" } as Morphology,
    };
    const parallelEdges: Edge[] = [
        ["enjoys", "She", "nsubj"],
        ["enjoys", "reading", "xcomp"],
        ["reading", "write", "conj"],
        ["write", "and", "cc"],
        ["write", "to", "mark"],
    ];
    it("reviews an explicit gerund/infinitive mismatch under a shared governor", () => {
        const issue = diagnostics(
            parsed("She enjoys reading and to write.", parallelEdges, parallelForms),
            "parallel-forms",
        )[0]!;
        expect(issue.evidence).toHaveLength(2);
        expect(issue.proposals).toEqual([]);
    });
    it("accepts different actions coordinated at the matrix-clause level", () => {
        expect(
            diagnostics(
                parsed(
                    "She enjoys reading and writes notes.",
                    [
                        ["enjoys", "She", "nsubj"],
                        ["enjoys", "reading", "xcomp"],
                        ["reading", "writes", "conj"],
                        ["writes", "and", "cc"],
                    ],
                    { ...parallelForms, writes: verb("write") },
                ),
                "parallel-forms",
            ),
        ).toEqual([]);
    });
    it("accepts compatible gerunds", () => {
        expect(
            diagnostics(
                parsed(
                    "She enjoys reading and writing.",
                    [
                        ["enjoys", "reading", "xcomp"],
                        ["reading", "writing", "conj"],
                        ["writing", "and", "cc"],
                    ],
                    {
                        ...parallelForms,
                        writing: { lemma: "write", pos: "VERB", finite: false, verbForm: "Part" },
                    },
                ),
                "parallel-forms",
            ),
        ).toEqual([]);
    });
    it("counts distinct compatible person references, including singular they", () => {
        const previous = parsed(
            "The teacher met the student.",
            [
                ["met", "teacher", "nsubj"],
                ["met", "student", "obj"],
            ],
            { met: verb("meet") },
        );
        for (const pronoun of ["She", "They"]) {
            const current = parsed(
                `${pronoun} smiled.`,
                [["smiled", pronoun, "nsubj"]],
                { smiled: verb("smile") },
                40,
            );
            const issues = documentRelationships([previous, current], false);
            expect(issues).toHaveLength(1);
            expect(issues[0]!.evidence).toHaveLength(2);
            expect(issues[0]!.proposals).toEqual([]);
        }
    });
    it("does not treat an inanimate object or duplicate parse edge as a second person", () => {
        const previous = parsed("The teacher wrote the report.", [
            ["wrote", "teacher", "nsubj"],
            ["wrote", "teacher", "obj"],
            ["wrote", "report", "obj"],
        ]);
        const current = parsed(
            "She smiled.",
            [["smiled", "She", "nsubj"]],
            { smiled: verb("smile") },
            40,
        );
        expect(documentRelationships([previous, current], false)).toEqual([]);
    });
});

describe("same-cause diagnostic resolution", () => {
    const s = parsed("The students is ready.", [
        ["ready", "students", "nsubj"],
        ["ready", "is", "cop"],
    ]);
    const span = s.tokens.find((t) => t.text === "is")!;
    const make = (
        rule: string,
        replacements: string[],
        certainty: "Likely error" | "Possible issue" = "Possible issue",
    ) =>
        finding(
            s,
            rule,
            "agreement",
            span,
            "Grammar",
            "Agreement",
            "Check the parsed subject.",
            replacements,
            certainty,
        );
    it("groups the explicit agreement aliases, preserves evidence, and ranks alternatives", () => {
        const baseline = make("agreement", ["are"], "Likely error"),
            neural = {
                ...make("neural-agreement", ["are", "were"]),
                evidence: [{ start: 4, end: 12, label: "Subject" }],
            };
        const resolved = new DiagnosticResolver().resolve([neural, baseline]);
        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.ruleId).toBe("agreement");
        expect(resolved[0]!.proposals.map((p) => p.edits[0]!.replacement)).toEqual(["are", "were"]);
        expect(resolved[0]!.evidence).toHaveLength(2);
        expect(baseline.proposals).toHaveLength(1);
    });
    it("preserves overlapping independent rules even when their skill or proposed edit matches", () => {
        const resolved = new DiagnosticResolver().resolve([
            make("agreement", ["are"]),
            make("independent-rule", ["are"]),
            { ...make("neural-agreement", ["are"]), category: "Usage" },
        ]);
        expect(resolved).toHaveLength(3);
    });
    it("does not lose different repairs when a rule emits duplicate identities", () => {
        const resolved = new DiagnosticResolver().resolve([
            make("agreement", ["are"]),
            make("agreement", ["were"]),
        ]);
        expect(resolved[0]!.proposals.map((p) => p.edits[0]!.replacement)).toEqual(["are", "were"]);
    });
    it("groups equivalent repairs even when the highlighting differs", () => {
        const narrow = make("agreement", ["are"], "Likely error"),
            wide = {
                ...make("neural-agreement", ["are"]),
                start: 4,
            };
        const resolved = new DiagnosticResolver().resolve([wide, narrow]);
        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.start).toBe(span.start);
    });
    it("merges transitive duplicate groups without discarding the preferred explanation", () => {
        const first = make("agreement", ["are"], "Likely error"),
            second = {
                ...make("neural-agreement", ["were"]),
                start: 4,
            },
            bridge = { ...make("neural-agreement", ["are", "were"]), start: 0 };
        const resolved = new DiagnosticResolver().resolve([first, second, bridge]);
        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.ruleId).toBe("agreement");
        expect(resolved[0]!.proposals).toHaveLength(2);
    });
    it("deduplicates a single producer's repairs and retains available validation", () => {
        const original = make("agreement", ["are", "are"]);
        const validated = {
            ...original,
            proposals: [
                {
                    ...original.proposals[0]!,
                    validation: {
                        status: "rechecked" as const,
                        checks: ["Source and target checked"],
                    },
                },
            ],
        };
        const resolved = new DiagnosticResolver().resolve([original, validated]);
        expect(resolved[0]!.proposals).toHaveLength(1);
        expect(resolved[0]!.proposals[0]!.validation?.status).toBe("rechecked");
    });
    it("is idempotent and retains every distinct repair under duplicate input", () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom("are", "were", "was"), { minLength: 1, maxLength: 30 }),
                (repairs) => {
                    const resolver = new DiagnosticResolver(),
                        input = repairs.map((repair) => make("agreement", [repair]));
                    const output = resolver.resolve(input);
                    expect(output).toHaveLength(1);
                    expect(
                        new Set(output[0]!.proposals.map((p) => p.edits[0]!.replacement)),
                    ).toEqual(new Set(repairs));
                    expect(resolver.resolve(output)).toEqual(output);
                },
            ),
            { numRuns: 100 },
        );
    });
});
