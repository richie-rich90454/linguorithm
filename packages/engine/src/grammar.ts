import type { Category, Certainty, Diagnostic, Sentence, SkillId, Span, Token } from "./domain";
import { SpellingIndex } from "./spelling";

export interface GrammarRule {
    id: string;
    version: string;
    skill: SkillId;
    description: string;
    evaluate(sentence: Sentence): readonly Diagnostic[];
}
function preserveCase(original: string, replacement: string): string {
    return /^[A-Z]/u.test(original)
        ? replacement[0]!.toUpperCase() + replacement.slice(1)
        : replacement;
}

function hasUnambiguousParticipleAnalysis(token: Token): boolean {
    if (token.pos !== "VERB" || token.analyses.length === 0) return false;
    const lemmas = new Set(token.analyses.map((analysis) => analysis.lemma.toLowerCase()));
    return (
        token.analyses.every(
            (analysis) => analysis.pos === "VERB" && analysis.verbForm === "Part",
        ) &&
        lemmas.size === 1 &&
        [...lemmas].every((lemma) => lemma.trim().length > 0 && lemma !== "_")
    );
}

function isParsedModalAuxiliary(token: Token): boolean {
    return token.pos === "AUX" && /^(could|would|should|must|might)$/iu.test(token.text);
}

export function finding(
    sentence: Sentence,
    ruleId: string,
    skill: SkillId,
    span: Span,
    category: Category,
    title: string,
    explanation: string,
    replacements: readonly string[],
    certainty: Certainty = "Likely error",
    evidence: Diagnostic["evidence"] = [],
): Diagnostic {
    const expected = sentence.text.slice(span.start - sentence.start, span.end - sentence.start);
    return {
        ...span,
        id: `${ruleId}:${span.start}:${span.end}`,
        ruleId,
        skill,
        category,
        title,
        explanation,
        certainty,
        evidence: evidence.length
            ? evidence
            : [{ ...span, label: expected || "Punctuation boundary" }],
        confidence: {
            calibrated: false,
            policy:
                certainty === "Confirmed error"
                    ? "Direct constraint; restricted construction"
                    : "Heuristic evidence; review in context. No calibrated probability available.",
        },
        proposals: replacements.map((replacement, i) => ({
            id: `${ruleId}:${span.start}:${i}`,
            label: replacement ? `Use “${replacement}”` : "Remove repeated word",
            provenance: `${ruleId}@1.0.0`,
            edits: [{ ...span, type: replacement ? "REPLACE" : "DELETE", expected, replacement }],
        })),
    };
}

const agreement: GrammarRule = {
    id: "agreement",
    version: "1.0.0",
    skill: "agreement",
    description:
        "Restricted subject–finite verb agreement, including intervening prepositional phrases.",
    evaluate(s) {
        const subjectEdge = s.graph.find((e) => e.relation === "nsubj");
        if (!subjectEdge || s.ambiguous) return [];
        const subject = s.tokens[subjectEdge.dependent]!;
        const verb = s.tokens[subjectEdge.head]!;
        if (!subject.analyses.some((a) => a.number)) return [];
        const sw = subject.text.toLowerCase(),
            vw = verb.text.toLowerCase();
        const prefix = s.tokens.slice(0, subjectEdge.head);
        // Coordination, quantities, existential there, inverted questions and collective nouns need a trained parser.
        if (
            prefix.some((t) => t.pos === "CCONJ") ||
            /^(there|you|who|what|which|none|all|some|most|data|news|series|species|means|police|staff|team|family|committee)$/u.test(
                sw,
            ) ||
            /\b(?:one|number|lot|percent|pair|part|half|majority)\b/iu.test(
                s.text.slice(0, verb.start - s.start),
            )
        )
            return [];
        let replacement: string | undefined;
        const plural = subject.analyses.some((a) => a.number === "plural");
        if (sw === "i")
            replacement = (
                { is: "am", are: "am", were: "was", has: "have", does: "do" } as Record<
                    string,
                    string
                >
            )[vw];
        else if (plural)
            replacement = (
                { is: "are", was: "were", has: "have", does: "do" } as Record<string, string>
            )[vw];
        else
            replacement = (
                { are: "is", were: "was", have: "has", do: "does" } as Record<string, string>
            )[vw];
        // Lexical present tense agreement is restricted to explicit personal pronouns.
        if (
            !replacement &&
            /^(he|she|it|they|we)$/u.test(sw) &&
            verb.pos === "VERB" &&
            /^(walks?|runs?|eats?|writes?|works?|stud(?:y|ies)|thinks?|knows?|makes?|go(?:es)?|says?|plays?|seems?|needs?|likes?|lives?|helps?|arrives?)$/u.test(
                vw,
            )
        ) {
            if (plural && vw.endsWith("s"))
                replacement = vw.endsWith("ies")
                    ? vw.slice(0, -3) + "y"
                    : /(?:ches|shes|xes|oes|sses)$/u.test(vw)
                      ? vw.slice(0, -2)
                      : vw.slice(0, -1);
            else if (!plural && !vw.endsWith("s"))
                replacement = /[^aeiou]y$/u.test(vw)
                    ? vw.slice(0, -1) + "ies"
                    : /(?:ch|sh|x|o|ss)$/u.test(vw)
                      ? vw + "es"
                      : vw + "s";
        }
        if (
            !replacement ||
            /\b(?:if|wish|would|could|should|must|may|might|will|can)\b/iu.test(
                s.text.slice(0, verb.start - s.start),
            )
        )
            return [];
        return [
            finding(
                s,
                this.id,
                this.skill,
                verb,
                "Grammar",
                "Match the verb to its subject",
                `“${subject.text}” is the subject of “${verb.text}”. The verb agrees with that subject, even when a prepositional phrase comes between them.`,
                [preserveCase(verb.text, replacement)],
                "Likely error",
                [
                    { start: subject.start, end: subject.end, label: "Grammatical subject" },
                    { start: verb.start, end: verb.end, label: "Finite verb" },
                ],
            ),
        ];
    },
};

const repeats: GrammarRule = {
    id: "repeated-word",
    version: "1.0.0",
    skill: "usage",
    description: "Adjacent accidental function-word repetition; valid repetitions are excluded.",
    evaluate(s) {
        const out: Diagnostic[] = [];
        for (let i = 1; i < s.tokens.length; i++) {
            const a = s.tokens[i - 1]!,
                b = s.tokens[i]!;
            if (
                a.text.toLowerCase() === b.text.toLowerCase() &&
                /^(the|a|an|of|to|in|on|for|with|and|but|is|are)$/iu.test(a.text) &&
                /^\s+$/u.test(s.text.slice(a.end - s.start, b.start - s.start))
            )
                out.push(
                    finding(
                        s,
                        this.id,
                        this.skill,
                        { start: a.end, end: b.end },
                        "Usage",
                        "A word appears twice",
                        `“${b.text}” is repeated immediately. Remove the extra copy if the repetition is accidental.`,
                        [""],
                        "Likely error",
                    ),
                );
        }
        return out;
    },
};

const misspellings: Record<string, string> = {
    teh: "the",
    recieve: "receive",
    recieved: "received",
    seperate: "separate",
    seperately: "separately",
    definately: "definitely",
    alot: "a lot",
    occured: "occurred",
    occuring: "occurring",
    accomodate: "accommodate",
    enviroment: "environment",
    goverment: "government",
    grammer: "grammar",
    becuase: "because",
    thier: "their",
    untill: "until",
    truely: "truly",
    writting: "writing",
    begining: "beginning",
    neccessary: "necessary",
    definatelye: "definitely",
    arguement: "argument",
    independant: "independent",
    accomodation: "accommodation",
    advertisment: "advertisement",
    abberation: "aberration",
    beleive: "believe",
    calender: "calendar",
    cemetary: "cemetery",
    concious: "conscious",
    enviromental: "environmental",
    existance: "existence",
    foriegn: "foreign",
    fourty: "forty",
    freind: "friend",
    immediatly: "immediately",
    knowlege: "knowledge",
    maintainance: "maintenance",
    methaporical: "metaphorical",
    millenium: "millennium",
    noticable: "noticeable",
    occassion: "occasion",
    personalit: "personality",
    persistant: "persistent",
    posession: "possession",
    priviledge: "privilege",
    publically: "publicly",
    recomend: "recommend",
    refered: "referred",
    relevent: "relevant",
    religous: "religious",
    simplier: "simpler",
    succesful: "successful",
    suprise: "surprise",
    tendancy: "tendency",
    technicaly: "technically",
    threshhold: "threshold",
    tommorow: "tomorrow",
    unecessary: "unnecessary",
    vacume: "vacuum",
    wether: "whether",
};
const spelling: GrammarRule = {
    id: "spelling",
    version: "1.0.0",
    skill: "usage",
    description: "Reviewed common misspellings; unfamiliar vocabulary is left unmarked.",
    evaluate(s) {
        return s.tokens.flatMap((t) => {
            const replacement = misspellings[t.text.toLowerCase()];
            return replacement
                ? [
                      finding(
                          s,
                          this.id,
                          this.skill,
                          t,
                          "Spelling",
                          "Check this spelling",
                          `The usual American English spelling is “${replacement}”. Names and specialized vocabulary may differ.`,
                          [preserveCase(t.text, replacement)],
                      ),
                  ]
                : [];
        });
    },
};

const missingContractionApostrophe: GrammarRule = {
    id: "missing-contraction-apostrophe",
    version: "1.0.0",
    skill: "punctuation",
    description: "Common unambiguous contractions typed without an apostrophe.",
    evaluate(s) {
        if (/[“”"']/u.test(s.text)) return [];
        const contractions: Readonly<Record<string, string>> = {
            dont: "don't",
            doesnt: "doesn't",
            didnt: "didn't",
            isnt: "isn't",
            arent: "aren't",
            wasnt: "wasn't",
            werent: "weren't",
            hasnt: "hasn't",
            havent: "haven't",
            hadnt: "hadn't",
            couldnt: "couldn't",
            wouldnt: "wouldn't",
            shouldnt: "shouldn't",
            mustnt: "mustn't",
            youre: "you're",
            theyre: "they're",
            weve: "we've",
            youve: "you've",
            theyve: "they've",
        };
        return s.tokens.flatMap((token) => {
            const replacement = contractions[token.text.toLowerCase()];
            return replacement
                ? [
                      finding(
                          s,
                          this.id,
                          this.skill,
                          token,
                          "Punctuation",
                          "Add the apostrophe in this contraction",
                          `The common contraction is written “${replacement}”, with an apostrophe marking omitted letters. Use the expanded form if it better fits your register.`,
                          [preserveCase(token.text, replacement)],
                      ),
                  ]
                : [];
        });
    },
};

const forms: GrammarRule = {
    id: "verb-form",
    version: "1.0.0",
    skill: "verb-forms",
    description: "Modal + base form and reviewed irregular participles.",
    evaluate(s) {
        const result: Diagnostic[] = [];
        for (let i = 1; i < s.tokens.length; i++) {
            const a = s.tokens[i - 1]!,
                b = s.tokens[i]!;
            const bw = b.text.toLowerCase();
            let replacement: string | undefined;
            if (/^(can|could|will|would|should|must|may|might)$/iu.test(a.text))
                replacement = (
                    {
                        goes: "go",
                        went: "go",
                        works: "work",
                        studies: "study",
                        writes: "write",
                        likes: "like",
                        has: "have",
                        is: "be",
                        was: "be",
                        does: "do",
                    } as Record<string, string>
                )[bw];
            if (/^(has|have|had)$/iu.test(a.text))
                replacement = (
                    {
                        went: "gone",
                        wrote: "written",
                        ate: "eaten",
                        saw: "seen",
                        did: "done",
                        took: "taken",
                        gave: "given",
                    } as Record<string, string>
                )[bw];
            if (replacement)
                result.push(
                    finding(
                        s,
                        this.id,
                        this.skill,
                        b,
                        "Grammar",
                        "Check the verb form",
                        /^(has|have|had)$/iu.test(a.text)
                            ? `After “${a.text}”, this construction needs the past participle “${replacement}”.`
                            : `The modal “${a.text}” takes the base form “${replacement}”.`,
                        [replacement],
                    ),
                );
        }
        return result;
    },
};

const articles: GrammarRule = {
    id: "article-sound",
    version: "1.0.0",
    skill: "usage",
    description: "A/an before reviewed, unambiguous initial sounds.",
    evaluate(s) {
        const result: Diagnostic[] = [];
        for (let i = 0; i < s.tokens.length - 1; i++) {
            const a = s.tokens[i]!,
                b = s.tokens[i + 1]!;
            const vowel =
                /^(apple|orange|egg|idea|example|essay|error|hour|honest|honor|umbrella|important|interesting|unusual|animal)$/iu.test(
                    b.text,
                );
            const consonant =
                /^(university|unicorn|user|useful|unique|one|book|student|sentence|teacher|dog|cat|house|year|European)$/iu.test(
                    b.text,
                );
            const replacement =
                /^a$/iu.test(a.text) && vowel
                    ? "an"
                    : /^an$/iu.test(a.text) && consonant
                      ? "a"
                      : undefined;
            if (replacement)
                result.push(
                    finding(
                        s,
                        this.id,
                        this.skill,
                        a,
                        "Usage",
                        "Choose the article by sound",
                        `Use “${replacement}” before “${b.text}”. A/an follows the opening sound, rather than the written letter alone.`,
                        [preserveCase(a.text, replacement)],
                    ),
                );
        }
        return result;
    },
};

const punctuation: GrammarRule = {
    id: "punctuation",
    version: "1.0.0",
    skill: "punctuation",
    description: "Restricted introductory transitions and adjacent independent clauses.",
    evaluate(s) {
        const result: Diagnostic[] = [];
        const transition =
            /^(However|Therefore|Nevertheless|Furthermore|Moreover|Consequently)\s+(?=[\p{L}])/iu.exec(
                s.text,
            );
        if (
            transition &&
            // Degree/concessive however ("however carefully...") is not a
            // sentence transition. Require an ordinary clause opening before
            // making this restricted deterministic comma proposal.
            (transition[1]!.toLowerCase() !== "however" ||
                ["DET", "PRON"].includes(s.tokens[1]?.pos ?? ""))
        ) {
            const end = s.start + transition[1]!.length;
            result.push(
                finding(
                    s,
                    "introductory-comma",
                    this.skill,
                    { start: end, end },
                    "Punctuation",
                    "Set off the introductory transition",
                    `Use a comma after the introductory transition “${transition[1]}”.`,
                    [","],
                ),
            );
        }
        for (let i = 0; i < s.tokens.length; i++) {
            const t = s.tokens[i]!;
            if (t.text !== ",") continue;
            const left = s.tokens.slice(0, i),
                right = s.tokens.slice(i + 1);
            const hasSubjectVerb = (tokens: readonly (typeof t)[]) =>
                tokens[0]?.pos === "PRON" &&
                tokens.slice(1, 3).some((v) => v.pos === "VERB" || v.pos === "AUX");
            if (
                hasSubjectVerb(left) &&
                hasSubjectVerb(right) &&
                !left.some((x) => x.pos === "SCONJ" || x.pos === "CCONJ") &&
                !right.some((x) => x.text === ",") &&
                !/\b(?:said|says|asked|replied)\b/iu.test(s.text)
            )
                result.push(
                    finding(
                        s,
                        "comma-splice",
                        "boundaries",
                        t,
                        "Punctuation",
                        "Give two clauses a stronger boundary",
                        "Each side of this comma appears to contain a subject and a finite verb. A semicolon can join these independent clauses without a coordinating conjunction.",
                        [";"],
                        "Possible issue",
                        [
                            { start: left[0]!.start, end: left.at(-1)!.end, label: "First clause" },
                            {
                                start: right[0]!.start,
                                end: right.at(-1)!.end,
                                label: "Second clause",
                            },
                        ],
                    ),
                );
        }
        return result;
    },
};

const pronouns: GrammarRule = {
    id: "pronoun-case",
    version: "1.0.0",
    skill: "pronouns",
    description: "Object case immediately after unambiguous prepositions.",
    evaluate(s) {
        const result: Diagnostic[] = [];
        for (let i = 1; i < s.tokens.length; i++) {
            const a = s.tokens[i - 1]!,
                b = s.tokens[i]!;
            const replacement = (
                { I: "me", he: "him", she: "her", we: "us", they: "them" } as Record<string, string>
            )[b.text];
            if (/^(between|among|with|for|from|beside)$/iu.test(a.text) && replacement)
                result.push(
                    finding(
                        s,
                        this.id,
                        this.skill,
                        b,
                        "Grammar",
                        "Use the object form of the pronoun",
                        `After the preposition “${a.text}”, use the object form “${replacement}”.`,
                        [replacement],
                    ),
                );
        }
        return result;
    },
};

const fragments: GrammarRule = {
    id: "dependent-fragment",
    version: "1.0.0",
    skill: "sentence",
    description: "Potential standalone subordinate clauses; no automatic rewrite.",
    evaluate(s) {
        return /^(because|although|unless|whereas)\b/iu.test(s.text) &&
            !s.tokens.some((t) => t.text === "," || t.text === ";")
            ? [
                  finding(
                      s,
                      this.id,
                      this.skill,
                      s,
                      "Grammar",
                      "Check for a complete main clause",
                      "This sentence begins with a subordinating conjunction. Check whether it has an independent main clause; it may intentionally answer a preceding question. No automatic correction is offered.",
                      [],
                      "Possible issue",
                  ),
              ]
            : [];
    },
};

const possessiveApostrophes: GrammarRule = {
    id: "possessive-apostrophe",
    version: "1.0.0",
    skill: "punctuation",
    description: "Reviewed possessive pronouns and irregular plural possessives, not noun plurals.",
    evaluate(s) {
        if (/[“”"]/u.test(s.text)) return [];
        const results: Diagnostic[] = [];
        for (let i = 0; i < s.tokens.length - 1; i++) {
            const token = s.tokens[i]!,
                next = s.tokens[i + 1]!;
            if (token.end !== next.start) continue;
            const word = token.text.toLowerCase();
            let replacement: string | undefined;
            if (/^(her|your|our|their)$/u.test(word) && /^['’]s$/u.test(next.text))
                replacement = word + "s";
            if (/^(childrens|mens|womens)$/u.test(word) && /^['’]$/u.test(next.text))
                replacement = word.slice(0, -1) + next.text + "s";
            if (!replacement) continue;
            results.push(
                finding(
                    s,
                    this.id,
                    this.skill,
                    { start: token.start, end: next.end },
                    "Punctuation",
                    "Check the possessive apostrophe",
                    /^(her|your|our|their)$/u.test(word)
                        ? "Possessive pronouns such as hers, yours, ours, and theirs do not take an apostrophe."
                        : "These irregular plurals do not end in s; form their possessives by adding apostrophe-s.",
                    [preserveCase(token.text, replacement)],
                    "Likely error",
                ),
            );
        }
        return results;
    },
};

const contextualUsage: GrammarRule = {
    id: "contextual-usage",
    version: "1.1.0",
    skill: "usage",
    description:
        "Finite contexts distinguishing its/it's, modal of/have, and comparative than/then, including unambiguous locally analyzed participles.",
    evaluate(s) {
        if (/[“”"]/u.test(s.text)) return [];
        return s.tokens.flatMap((token, i) => {
            const previous = s.tokens[i - 1],
                next = s.tokens[i + 1];
            if (
                token.text.toLowerCase() === "it" &&
                next &&
                /^['’]s$/u.test(next.text) &&
                token.end === next.start &&
                /^(cover|color|size|shape|purpose|title|owner|author)$/iu.test(
                    s.tokens[i + 2]?.text ?? "",
                ) &&
                /^(is|are|was|were)$/iu.test(s.tokens[i + 3]?.text ?? "")
            )
                return [
                    finding(
                        s,
                        this.id,
                        this.skill,
                        { start: token.start, end: next.end },
                        "Usage",
                        "Check the possessive form of its",
                        "This noun is followed by its own finite verb. The possessive determiner its has no apostrophe; it's instead means it is or it has.",
                        [preserveCase(token.text, "its")],
                        "Likely error",
                    ),
                ];
            if (
                i === 0 &&
                token.text.toLowerCase() === "its" &&
                next &&
                /^(raining|snowing)$/iu.test(next.text) &&
                s.tokens.slice(i + 2).every((t) => /^[.!?]$/u.test(t.text))
            )
                return [
                    finding(
                        s,
                        this.id,
                        this.skill,
                        token,
                        "Usage",
                        "Check the contraction for it is",
                        "This weather expression needs it is, commonly contracted as it's. Its without an apostrophe is a possessive determiner.",
                        [preserveCase(token.text, "it's")],
                        "Likely error",
                    ),
                ];
            if (
                !previous ||
                !next ||
                !/^\s+$/u.test(s.text.slice(previous.end - s.start, token.start - s.start)) ||
                !/^\s+$/u.test(s.text.slice(token.end - s.start, next.start - s.start))
            )
                return [];
            let replacement: string | undefined;
            let explanation = "";
            if (
                token.text.toLowerCase() === "of" &&
                isParsedModalAuxiliary(previous) &&
                (/^(been|gone|done|seen|written|taken|given|eaten|known)$/iu.test(next.text) ||
                    hasUnambiguousParticipleAnalysis(next))
            ) {
                replacement = "have";
                explanation =
                    "A modal followed by this past participle uses have. The contraction may sound like of, but of does not form the perfect auxiliary.";
            }
            if (
                token.text.toLowerCase() === "then" &&
                /^(better|worse|taller|shorter|larger|smaller|older|younger|faster|slower)$/iu.test(
                    previous.text,
                ) &&
                /^(me|him|her|us|them)$/iu.test(next.text) &&
                (!s.tokens[i + 2] || /^[.!?,;]$/u.test(s.tokens[i + 2]!.text))
            ) {
                replacement = "than";
                explanation =
                    "This comparative followed by an object pronoun normally introduces its comparison with than. Then instead expresses a time or sequence.";
            }
            return replacement
                ? [
                      finding(
                          s,
                          this.id,
                          this.skill,
                          token,
                          "Usage",
                          "Check the word in this construction",
                          explanation,
                          [preserveCase(token.text, replacement)],
                          "Likely error",
                      ),
                  ]
                : [];
        });
    },
};

const quotationPunctuation: GrammarRule = {
    id: "quotation-punctuation",
    version: "1.0.0",
    skill: "punctuation",
    description: "American comma/period placement in a single direct-speech quotation.",
    evaluate(s) {
        const quotes = s.tokens.filter((t) => /^[“”"]$/u.test(t.text));
        if (quotes.length !== 2) return [];
        const [open, close] = quotes;
        if (
            !open ||
            !close ||
            !(
                (open.text === "“" && close.text === "”") ||
                (open.text === '"' && close.text === '"')
            )
        )
            return [];
        const index = s.tokens.indexOf(open);
        const prefix = s.tokens.slice(0, index).filter((t) => t.pos !== "PUNCT");
        // Restrict the convention to a reporting clause; literal strings and quoted terms may differ.
        if (!/^(said|says|asked|replied)$/iu.test(prefix.at(-1)?.text ?? "")) return [];
        const after = s.tokens[s.tokens.indexOf(close) + 1];
        const before = s.tokens[s.tokens.indexOf(close) - 1];
        if (
            !after ||
            !before ||
            close.end !== after.start ||
            !/^[.,]$/u.test(after.text) ||
            /^[.!?,;:]$/u.test(before.text)
        )
            return [];
        return [
            finding(
                s,
                this.id,
                this.skill,
                { start: close.start, end: after.end },
                "Punctuation",
                "Review punctuation at the closing quotation mark",
                "In ordinary American direct speech, commas and periods go inside the closing quotation mark. Literal transcriptions and other English varieties may use a different convention.",
                [after.text + close.text],
                "Possible issue",
            ),
        ];
    },
};

export const rules: readonly GrammarRule[] = [
    agreement,
    repeats,
    spelling,
    missingContractionApostrophe,
    forms,
    articles,
    punctuation,
    pronouns,
    fragments,
    possessiveApostrophes,
    contextualUsage,
    quotationPunctuation,
];
export class GrammarConstraintEngine {
    constructor(readonly registry: readonly GrammarRule[] = rules) {}
    evaluate(sentence: Sentence): Diagnostic[] {
        return this.registry.flatMap((rule) => rule.evaluate(sentence));
    }
}
export class CandidateGenerator {
    constructor(private readonly spellingIndex = new SpellingIndex()) {}
    spellingCandidates(word: string): string[] {
        return this.spellingIndex.candidates(word);
    }
}
export class DiagnosticResolver {
    resolve(diagnostics: readonly Diagnostic[]): Diagnostic[] {
        const cause = (d: Diagnostic) =>
            d.ruleId === "neural-agreement"
                ? "agreement"
                : d.ruleId === "dictionary-spelling"
                  ? "spelling"
                  : d.ruleId;
        const editKey = (p: Diagnostic["proposals"][number]) =>
            JSON.stringify(
                [...p.edits]
                    .sort((a, b) => a.start - b.start || a.end - b.end)
                    .map((e) => [e.start, e.end, e.expected, e.replacement]),
            );
        const priority: Record<Certainty, number> = {
            "Confirmed error": 0,
            "Likely error": 1,
            "Possible issue": 2,
            "Style suggestion": 3,
        };
        const merge = (existing: Diagnostic, incoming: Diagnostic): Diagnostic => {
            const proposals = new Map(existing.proposals.map((p) => [editKey(p), p]));
            for (const p of incoming.proposals) {
                const prior = proposals.get(editKey(p));
                if (!prior || (!prior.validation && p.validation)) proposals.set(editKey(p), p);
            }
            const evidence = new Map(existing.evidence.map((e) => [JSON.stringify(e), e]));
            for (const e of incoming.evidence) evidence.set(JSON.stringify(e), e);
            return {
                ...existing,
                evidence: [...evidence.values()],
                proposals: [...proposals.values()],
            };
        };
        interface Group {
            diagnostic: Diagnostic;
            order: number;
            parent?: Group;
        }
        const groups: Group[] = [],
            locations = new Map<string, Group>(),
            repairs = new Map<string, Group>();
        const root = (group: Group): Group => {
            let ancestor = group;
            while (ancestor.parent) ancestor = ancestor.parent;
            let current = group;
            while (current.parent) {
                const next = current.parent;
                current.parent = ancestor;
                current = next;
            }
            return ancestor;
        };
        // A shared skill or an overlapping span is insufficient evidence of a shared cause.
        for (const d of [...diagnostics].sort(
            (a, b) =>
                priority[a.certainty] - priority[b.certainty] ||
                a.ruleId.localeCompare(b.ruleId) ||
                a.id.localeCompare(b.id),
        )) {
            const family = JSON.stringify([cause(d), d.category, d.skill]);
            const key = JSON.stringify([family, d.start, d.end]);
            const repairKeys = d.proposals.map((p) => JSON.stringify([family, editKey(p)]));
            const matches = new Set<Group>();
            const location = locations.get(key);
            if (location) matches.add(root(location));
            for (const repair of repairKeys) {
                const prior = repairs.get(repair);
                if (prior) matches.add(root(prior));
            }
            const ordered = [...matches].sort((a, b) => a.order - b.order);
            const group = ordered[0] ?? { diagnostic: merge(d, d), order: groups.length };
            if (!ordered.length) groups.push(group);
            else {
                for (const other of ordered.slice(1)) {
                    group.diagnostic = merge(group.diagnostic, other.diagnostic);
                    other.parent = group;
                }
                group.diagnostic = merge(group.diagnostic, d);
            }
            locations.set(key, group);
            for (const repair of repairKeys) repairs.set(repair, group);
        }
        return groups
            .filter((group) => !group.parent)
            .map((group) => group.diagnostic)
            .sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));
    }
}
