import type { Dependency, Diagnostic, Sentence, Token, WritingIntent } from "./domain";
import { finding, type GrammarRule } from "./grammar";
import type {
    CountNounInflections,
    PastParticipleInflections,
    PresentVerbInflections,
} from "./inflections";

const hasQuotes = (s: Sentence) => /[“”"]/u.test(s.text);
const subjectRelation = (relation: string) => ["nsubj", "nsubj:pass"].includes(relation);
const stableEdge = (s: Sentence, edge: Dependency) => {
    if (s.ambiguous) return false;
    const alternatives = s.alternatives ?? [];
    const bestScore = Math.max(...alternatives.map((alternative) => alternative.score));
    // A low-ranked beam survivor should not veto evidence from the selected parse.
    // Keep abstaining when a competitive alternative changes the same relationship.
    return alternatives
        .filter((alternative) => bestScore - alternative.score < 1)
        .every((alternative) =>
            alternative.graph.some(
                (candidate) =>
                    candidate.head === edge.head &&
                    candidate.dependent === edge.dependent &&
                    candidate.relation === edge.relation,
            ),
        );
};
const finite = (token: Token) =>
    ["VERB", "AUX"].includes(token.pos) &&
    token.analyses.some((analysis) => analysis.pos === token.pos && analysis.finite === true);
const coveringSpan = (...tokens: readonly Token[]) => ({
    start: Math.min(...tokens.map((token) => token.start)),
    end: Math.max(...tokens.map((token) => token.end)),
});
type QuoteRange = readonly [number, number];
function quoteRanges(text: string): QuoteRange[] {
    const ranges: QuoteRange[] = [];
    const open: { mark: '"' | "“"; start: number }[] = [];
    for (let index = 0; index < text.length; index++) {
        const mark = text[index];
        const current = open.at(-1);
        if (mark === '"') {
            if (current?.mark === '"') {
                open.pop();
                ranges.push([current.start, index]);
            } else if (!current || current.mark === "“") open.push({ mark: '"', start: index });
        } else if (mark === "“") open.push({ mark, start: index });
        else if (mark === "”" && current?.mark === "“") {
            open.pop();
            ranges.push([current.start, index]);
        }
    }
    for (const quote of open) ranges.push([quote.start, text.length]);
    return ranges;
}
const tokenIsQuoted = (s: Sentence, token: Token, ranges: readonly QuoteRange[]) => {
    const start = token.start - s.start;
    return ranges.some(([open, close]) => start > open && start < close);
};
function isSubjunctiveWere(s: Sentence, clauseHead: number, verb: Token): boolean {
    if (verb.text.toLowerCase() !== "were") return false;
    if (
        s.graph.some(
            (edge) =>
                edge.head === clauseHead &&
                edge.relation === "mark" &&
                /^(if|unless)$/iu.test(s.tokens[edge.dependent]!.text),
        )
    )
        return true;
    return s.graph.some((edge) => {
        if (edge.dependent !== clauseHead || !["ccomp", "xcomp"].includes(edge.relation))
            return false;
        return s.tokens[edge.head]!.analyses.some(
            (analysis) => analysis.pos === "VERB" && analysis.lemma.toLowerCase() === "wish",
        );
    });
}
function grammaticalNumber(token: Token): "singular" | "plural" | undefined {
    const numbers = [
        ...new Set(
            token.analyses
                .map(
                    (analysis) =>
                        analysis.number ??
                        (analysis.udFeatures?.Number === "Sing"
                            ? "singular"
                            : analysis.udFeatures?.Number === "Plur"
                              ? "plural"
                              : undefined),
                )
                .filter(Boolean),
        ),
    ];
    if (numbers.length === 1) return numbers[0];
    if (numbers.length > 1 || !["NOUN", "PROPN"].includes(token.pos)) return undefined;
    const analyses = token.analyses.filter((analysis) => analysis.pos === token.pos);
    const lemmas = [...new Set(analyses.map((analysis) => analysis.lemma.toLowerCase()))];
    if (lemmas.length !== 1) return undefined;
    const surface = token.text.toLowerCase();
    const lemma = lemmas[0]!;
    if (surface === lemma) return /(?:s|x|z|sh|ch)$/u.test(surface) ? undefined : "singular";
    const pluralLemmas = [];
    if (surface.endsWith("ies")) pluralLemmas.push(`${surface.slice(0, -3)}y`);
    if (surface.endsWith("es")) {
        const base = surface.slice(0, -2);
        pluralLemmas.push(base);
        if (base.endsWith("zz")) pluralLemmas.push(base.slice(0, -1));
    }
    if (surface.endsWith("s")) pluralLemmas.push(surface.slice(0, -1));
    return pluralLemmas.includes(lemma) ? "plural" : undefined;
}
function coordinatedSubjectNumber(s: Sentence, subjectIndex: number): "plural" | undefined {
    const members = new Set([subjectIndex]);
    for (let changed = true; changed;) {
        changed = false;
        for (const edge of s.graph)
            if (edge.relation === "conj" && stableEdge(s, edge)) {
                if (members.has(edge.head) && !members.has(edge.dependent)) {
                    members.add(edge.dependent);
                    changed = true;
                } else if (members.has(edge.dependent) && !members.has(edge.head)) {
                    members.add(edge.head);
                    changed = true;
                }
            }
    }
    if (
        members.size < 2 ||
        [...members].some((index) => !["NOUN", "PROPN", "PRON"].includes(s.tokens[index]!.pos))
    )
        return undefined;
    const coordinators = s.graph
        .filter(
            (edge) =>
                edge.relation === "cc" &&
                (members.has(edge.head) || members.has(edge.dependent)) &&
                stableEdge(s, edge),
        )
        .map((edge) => s.tokens[edge.dependent]!.text.toLowerCase());
    return coordinators.includes("and") &&
        !coordinators.some((word) => ["or", "nor"].includes(word))
        ? "plural"
        : undefined;
}
const cardinalUnits: Readonly<Record<string, number>> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
};
const pluralSelectingQuantifiers = new Set([
    "both",
    "few",
    "fewer",
    "many",
    "multiple",
    "numerous",
    "several",
    "various",
]);
function cardinalValue(surface: string): number | undefined {
    const normalized = surface.toLowerCase().replaceAll(",", "");
    if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
        const value = Number(normalized);
        return Number.isFinite(value) ? value : undefined;
    }
    const words = normalized.split(/[-\s]+/u).filter((word) => word && word !== "and");
    if (!words.length) return undefined;
    let total = 0;
    let group = 0;
    for (const word of words) {
        const value = cardinalUnits[word];
        if (value !== undefined) group += value;
        else if (word === "hundred" && group > 0) group *= 100;
        else if ((word === "thousand" || word === "million") && group > 0) {
            total += group * (word === "thousand" ? 1_000 : 1_000_000);
            group = 0;
        } else return undefined;
    }
    return total + group;
}
const countNounNumber = (countNouns?: CountNounInflections): GrammarRule => ({
    id: "count-noun-number",
    version: "1.0.0",
    skill: "usage",
    description:
        "Review parsed singular count nouns with a stable plural-selecting numeral or determiner.",
    evaluate(s) {
        if (!countNouns || s.syntaxSource !== "neural" || s.ambiguous || hasQuotes(s)) return [];
        const findings: Diagnostic[] = [];
        for (const edge of s.graph) {
            if (
                !stableEdge(s, edge) ||
                !["nummod", "det", "det:predet", "amod"].includes(edge.relation)
            )
                continue;
            const noun = s.tokens[edge.head]!;
            const quantifier = s.tokens[edge.dependent]!;
            if (
                !countNouns.supports(noun) ||
                grammaticalNumber(noun) !== "singular" ||
                s.graph.some(
                    (candidate) =>
                        candidate.dependent === edge.head &&
                        ["compound", "nmod"].includes(candidate.relation) &&
                        ["NOUN", "PROPN"].includes(s.tokens[candidate.head]!.pos),
                )
            )
                continue;
            const cardinal =
                edge.relation === "nummod" ? cardinalValue(quantifier.text) : undefined;
            const hasIndefiniteArticle =
                edge.relation === "nummod" &&
                s.graph.some(
                    (candidate) =>
                        candidate.head === edge.head &&
                        candidate.relation === "det" &&
                        /^(a|an)$/iu.test(s.tokens[candidate.dependent]!.text),
                );
            if (hasIndefiniteArticle) continue;
            const pluralRequired =
                (edge.relation === "nummod" &&
                    quantifier.pos === "NUM" &&
                    (cardinal === 0 || (cardinal !== undefined && cardinal > 1))) ||
                (["det", "det:predet", "amod"].includes(edge.relation) &&
                    pluralSelectingQuantifiers.has(quantifier.text.toLowerCase()));
            if (!pluralRequired) continue;
            findings.push(
                finding(
                    s,
                    this.id,
                    this.skill,
                    noun,
                    "Grammar",
                    "Review the noun form after a plural quantity",
                    `The local parse links “${quantifier.text}” to the singular-form noun “${noun.text}”. A count noun normally takes a plural form after zero or more than one. Check the intended meaning; this detector does not propose an unvalidated rewrite.`,
                    [],
                    "Possible issue",
                    [
                        { start: quantifier.start, end: quantifier.end, label: "Plural quantity" },
                        { start: noun.start, end: noun.end, label: "Parsed count noun" },
                    ],
                ),
            );
        }
        return findings;
    },
});
const parsedFinitePredicate = (s: Sentence, index: number) =>
    finite(s.tokens[index]!) ||
    (s.tokens[index]!.pos === "VERB" &&
        s.graph.some(
            (edge) => edge.head === index && edge.dependent === index && edge.relation === "root",
        ));

const subjectCase: GrammarRule = {
    id: "subject-case",
    version: "1.0.0",
    skill: "pronouns",
    description: "Subject-case constraints on parsed subject dependencies",
    evaluate(s) {
        if (s.ambiguous) return [];
        return s.graph
            .filter((e) => e.relation === "nsubj")
            .flatMap((edge) => {
                const token = s.tokens[edge.dependent]!,
                    replacement = (
                        { me: "I", him: "He", her: "She", us: "We", them: "They" } as Record<
                            string,
                            string
                        >
                    )[token.text.toLowerCase()];
                const predicate = s.tokens[edge.head]!;
                const auxiliaries = s.graph
                    .filter(
                        (e) =>
                            e.head === edge.head && ["cop", "aux", "aux:pass"].includes(e.relation),
                    )
                    .map((e) => s.tokens[e.dependent]!);
                // Accusative subjects of infinitives ("I saw him leave") are licensed.
                return replacement &&
                    stableEdge(s, edge) &&
                    !hasQuotes(s) &&
                    (finite(predicate) || auxiliaries.some(finite)) &&
                    !s.graph.some(
                        (e) => e.dependent === edge.head && ["xcomp", "ccomp"].includes(e.relation),
                    )
                    ? [
                          finding(
                              s,
                              this.id,
                              this.skill,
                              token,
                              "Grammar",
                              "Check the pronoun’s subject form",
                              `The parse assigns “${token.text}” the subject role. In an ordinary finite clause, that role uses “${replacement}”.`,
                              [
                                  replacement === "I" || token.start === s.start
                                      ? replacement
                                      : replacement.toLowerCase(),
                              ],
                              "Possible issue",
                              [
                                  { start: token.start, end: token.end, label: "Parsed subject" },
                                  {
                                      start: s.tokens[edge.head]!.start,
                                      end: s.tokens[edge.head]!.end,
                                      label: "Predicate",
                                  },
                              ],
                          ),
                      ]
                    : [];
            });
    },
};
const comparison: GrammarRule = {
    id: "double-comparison",
    version: "1.0.0",
    skill: "usage",
    description: "Redundant comparative degree on an adjective dependency",
    evaluate(s) {
        return s.graph
            .filter((e) => e.relation === "advmod")
            .flatMap((edge) => {
                const modifier = s.tokens[edge.dependent]!,
                    head = s.tokens[edge.head]!;
                const matches =
                    (modifier.text.toLowerCase() === "more" &&
                        /^(better|worse|lesser)$/iu.test(head.text)) ||
                    (modifier.text.toLowerCase() === "most" && /^(best|worst)$/iu.test(head.text));
                return matches &&
                    stableEdge(s, edge) &&
                    modifier.end <= head.start &&
                    !/[“”"]/u.test(s.text)
                    ? [
                          finding(
                              s,
                              this.id,
                              this.skill,
                              { start: modifier.start, end: head.start },
                              "Usage",
                              "Express comparative degree once",
                              `“${head.text}” already expresses this degree of comparison. An extra “${modifier.text}” is usually unnecessary in standard American English.`,
                              [""],
                              "Likely error",
                          ),
                      ]
                    : [];
            });
    },
};
// UD copular and auxiliary constructions put the clause head on a nonfinite
// lexical predicate. Only stable finite evidence licenses a boundary finding.
const clauseFinite = (s: Sentence, head: number) =>
    finite(s.tokens[head]!) ||
    s.graph.some(
        (edge) =>
            edge.head === head &&
            ["cop", "aux", "aux:pass"].includes(edge.relation) &&
            stableEdge(s, edge) &&
            finite(s.tokens[edge.dependent]!),
    );
const surfaceTensedPredicate = (token: Token) =>
    finite(token) ||
    token.analyses.some(
        (analysis) =>
            analysis.pos === token.pos && (analysis.tense === "Past" || analysis.tense === "Pres"),
    );
const subordinateMarkers = new Set([
    "although",
    "as",
    "because",
    "before",
    "if",
    "once",
    "since",
    "though",
    "unless",
    "until",
    "when",
    "whenever",
    "where",
    "whereas",
    "wherever",
    "while",
]);
function closesIntroductorySubordinate(s: Sentence, comma: Token): boolean {
    if (s.tokens.find((token) => token.text === ",")?.start !== comma.start) return false;
    const markerIndex = s.tokens.findIndex((token) => /\p{L}/u.test(token.text));
    const marker = s.tokens[markerIndex];
    if (!marker || !subordinateMarkers.has(marker.text.toLowerCase())) return false;

    // A sentence-initial word such as "as" can also begin a phrase ("as usual")
    // before an independent clause. When a parser omitted the `mark` edge, use
    // the subject's surface position as clause evidence instead of suppressing
    // every comma after any sentence-initial subordinator-looking word.
    const leftClause = s.graph.find((edge) => {
        if (!subjectRelation(edge.relation) || !stableEdge(s, edge)) return false;
        const subject = s.tokens[edge.dependent]!;
        const predicate = s.tokens[edge.head]!;
        if (
            subject.start <= marker.end ||
            subject.end > comma.start ||
            predicate.end > comma.start ||
            !["VERB", "AUX"].includes(predicate.pos) ||
            !surfaceTensedPredicate(predicate)
        )
            return false;

        if (
            s.graph.some(
                (candidate) =>
                    candidate.head === edge.head &&
                    candidate.relation === "mark" &&
                    stableEdge(s, candidate) &&
                    subordinateMarkers.has(s.tokens[candidate.dependent]!.text.toLowerCase()),
            )
        )
            return true;

        const between = s.tokens.filter(
            (token) => token.start >= marker.end && token.end <= subject.start,
        );
        // Personal pronouns cannot take an attributive adjective before them:
        // "as usual I rose" is an initial phrase plus a main clause, while
        // "when I arrived" and "as she predicted" have clause-shaped openings.
        if (subject.pos === "PRON") return between.length === 0;
        return (
            ["NOUN", "PROPN"].includes(subject.pos) &&
            between.every((token) => ["DET", "ADJ", "ADV", "NUM"].includes(token.pos))
        );
    });
    return leftClause !== undefined;
}
function parsedSubjectsAroundComma(s: Sentence): Diagnostic[] {
    const subjects = s.graph.filter(
        (edge) => subjectRelation(edge.relation) && stableEdge(s, edge),
    );
    const findings: Diagnostic[] = [];
    for (const comma of s.tokens.filter((token) => token.text === ",")) {
        // Some valid introductory clauses lose their `mark` edge in an
        // uncertain browser parse. The first comma after a sentence-initial
        // subordinator closes that dependent clause; later commas still go
        // through the full clause check (for example, a splice after the main
        // clause in a three-clause sentence).
        if (closesIntroductorySubordinate(s, comma)) continue;
        const left = subjects.filter((edge) => {
            const subject = s.tokens[edge.dependent]!;
            const predicate = s.tokens[edge.head]!;
            return (
                subject.end <= comma.start &&
                predicate.end <= comma.start &&
                ["VERB", "AUX"].includes(predicate.pos) &&
                surfaceTensedPredicate(predicate)
            );
        });
        const right = subjects.filter((edge) => {
            const subject = s.tokens[edge.dependent]!;
            const predicate = s.tokens[edge.head]!;
            return (
                subject.start >= comma.end &&
                predicate.start >= comma.end &&
                ["VERB", "AUX"].includes(predicate.pos) &&
                surfaceTensedPredicate(predicate)
            );
        });
        for (const first of left) {
            const firstPredicate = s.tokens[first.head]!;
            const firstSubject = s.tokens[first.dependent]!;
            // Inspect the marker attached to this clause, rather than every
            // earlier word in the sentence. A marker inside an embedded
            // complement ("I know when you arrived, she left") must not hide
            // the independent clause headed by "know".
            const firstClauseIsMarkedSubordinate = s.graph.some(
                (edge) =>
                    edge.head === first.head &&
                    edge.relation === "mark" &&
                    subordinateMarkers.has(s.tokens[edge.dependent]!.text.toLowerCase()),
            );
            if (firstClauseIsMarkedSubordinate) continue;
            for (const second of right) {
                const secondPredicate = s.tokens[second.head]!;
                const secondSubject = s.tokens[second.dependent]!;
                const clauseLink = s.graph.find(
                    (edge) =>
                        ["advcl", "conj", "parataxis"].includes(edge.relation) &&
                        ((edge.head === first.head && edge.dependent === second.head) ||
                            (edge.head === second.head && edge.dependent === first.head)) &&
                        stableEdge(s, edge),
                );
                const secondStart = Math.min(secondSubject.start, secondPredicate.start);
                const between = s.tokens.filter(
                    (token) => token.start >= comma.end && token.start < secondStart,
                );
                if (
                    first.head === second.head ||
                    !clauseLink ||
                    between.some(
                        (token) =>
                            subordinateMarkers.has(token.text.toLowerCase()) ||
                            /^(and|but|for|nor|or|so|yet)$/iu.test(token.text),
                    )
                )
                    continue;
                findings.push(
                    finding(
                        s,
                        "comma-splice",
                        "punctuation",
                        comma,
                        "Punctuation",
                        "Check the boundary between independent clauses",
                        "The local parse finds a tensed subject–predicate relationship on each side of this comma, with no subordinating marker or coordinator. Review whether these clauses need a stronger boundary; an introductory subordinate clause or a deliberate rhetorical choice can change the reading.",
                        [";"],
                        "Possible issue",
                        [
                            {
                                ...coveringSpan(firstSubject, firstPredicate),
                                label: "First tensed subject–predicate relationship",
                            },
                            {
                                ...coveringSpan(secondSubject, secondPredicate),
                                label: "Second tensed subject–predicate relationship",
                            },
                        ],
                    ),
                );
            }
        }
    }
    return findings.filter(
        (diagnostic, index) =>
            findings.findIndex(
                (candidate) =>
                    candidate.ruleId === diagnostic.ruleId &&
                    candidate.start === diagnostic.start &&
                    candidate.end === diagnostic.end,
            ) === index,
    );
}
function independentClause(s: Sentence, head: number, seen = new Set<number>()): boolean {
    if (seen.has(head)) return false;
    seen.add(head);
    if (s.graph.some((edge) => edge.head === head && edge.relation === "mark")) return false;
    const parents = s.graph.filter((edge) => edge.dependent === head && edge.head !== head);
    return parents.every(
        (edge) =>
            ["parataxis", "conj"].includes(edge.relation) &&
            stableEdge(s, edge) &&
            independentClause(s, edge.head, new Set(seen)),
    );
}
function subjectStart(s: Sentence, subject: number): number {
    const members = new Set([subject]);
    // Include the determiner and premodifiers, but not an attached relative
    // clause or apposition whose punctuation needs a separate analysis.
    for (let changed = true; changed;) {
        changed = false;
        for (const edge of s.graph) {
            if (
                members.has(edge.head) &&
                !members.has(edge.dependent) &&
                /^(det|amod|compound|nummod|flat|fixed)(:|$)/u.test(edge.relation) &&
                stableEdge(s, edge)
            ) {
                members.add(edge.dependent);
                changed = true;
            }
        }
    }
    return Math.min(...[...members].map((index) => s.tokens[index]!.start));
}
const boundaries: GrammarRule = {
    id: "parsed-boundary",
    version: "1.0.0",
    skill: "boundaries",
    description: "Finite independent clauses in parataxis or unmarked coordination",
    evaluate(s) {
        if (s.ambiguous || /[“”"]/u.test(s.text)) return [];
        const parsed = s.graph
            .filter((e) => ["parataxis", "conj"].includes(e.relation))
            .flatMap((edge) => {
                const a = s.graph.find(
                        (e) => e.relation.startsWith("nsubj") && e.head === edge.head,
                    ),
                    b = s.graph.find(
                        (e) => e.relation.startsWith("nsubj") && e.head === edge.dependent,
                    );
                if (
                    !a ||
                    !b ||
                    !stableEdge(s, edge) ||
                    !stableEdge(s, a) ||
                    !stableEdge(s, b) ||
                    b.dependent <= edge.head ||
                    b.dependent >= edge.dependent ||
                    !clauseFinite(s, edge.head) ||
                    !clauseFinite(s, edge.dependent) ||
                    !independentClause(s, edge.head) ||
                    !independentClause(s, edge.dependent) ||
                    s.graph.some(
                        (e) => [edge.head, edge.dependent].includes(e.head) && e.relation === "cc",
                    )
                )
                    return [];
                const first = s.tokens[edge.head]!;
                let start = subjectStart(s, b.dependent);
                // A conjunctive adverb is part of the second clause, not a
                // coordinator: “..., however, the train was late.”
                for (const child of s.graph)
                    if (
                        child.head === edge.dependent &&
                        child.relation === "advmod" &&
                        stableEdge(s, child) &&
                        s.tokens[child.dependent]!.start > first.end &&
                        s.tokens[child.dependent]!.end <= start
                    )
                        start = s.tokens[child.dependent]!.start;
                if (start <= first.end) return [];
                const between = s.tokens.filter((t) => t.start >= first.end && t.end <= start);
                if (
                    between.some(
                        (t) =>
                            t.pos === "CCONJ" ||
                            t.pos === "SCONJ" ||
                            /[;:.!?—–()[\]]/u.test(t.text),
                    )
                )
                    return [];
                const comma = [...between].reverse().find((t) => t.text === ",");
                if (comma && closesIntroductorySubordinate(s, comma)) return [];
                // Consume existing whitespace for an exact, well-spaced repair.
                const span = comma ?? { start: start - 1, end: start };
                if (!comma && s.text.slice(span.start - s.start, span.end - s.start) !== " ")
                    return [];
                return [
                    finding(
                        s,
                        comma ? "comma-splice" : "run-on",
                        this.skill,
                        span,
                        "Punctuation",
                        comma
                            ? "Check the boundary between independent clauses"
                            : "Add a boundary between independent clauses",
                        "The parser identifies two predicates with their own subjects. Review whether these independent clauses need a semicolon, a period, or a coordinating conjunction. Dialogue and intentional rhetoric may differ.",
                        [comma ? ";" : "; "],
                        "Possible issue",
                        [
                            {
                                ...coveringSpan(s.tokens[a.dependent]!, first),
                                label: "First subject–predicate relationship",
                            },
                            {
                                ...coveringSpan(s.tokens[b.dependent]!, s.tokens[edge.dependent]!),
                                label: "Second subject–predicate relationship",
                            },
                        ],
                    ),
                ];
            });
        const fallback = parsedSubjectsAroundComma(s);
        const findings = [...parsed, ...fallback];
        return findings.filter(
            (diagnostic, index) =>
                findings.findIndex(
                    (candidate) =>
                        candidate.ruleId === diagnostic.ruleId &&
                        candidate.start === diagnostic.start &&
                        candidate.end === diagnostic.end,
                ) === index,
        );
    },
};
const subordinateFragments: GrammarRule = {
    id: "dependent-fragment",
    version: "1.0.0",
    skill: "sentence",
    description: "Finite subordinate roots without a parsed independent main clause",
    evaluate(s) {
        if (s.ambiguous || s.syntaxSource !== "neural" || hasQuotes(s)) return [];
        const roots = s.graph.filter((edge) => edge.relation === "root");
        if (roots.length !== 1) return [];
        const root = roots[0]!;
        const marker = s.graph.find(
            (edge) =>
                edge.head === root.dependent &&
                edge.relation === "mark" &&
                /^(although|because|unless|whereas|though|while|when|after|before|since)$/iu.test(
                    s.tokens[edge.dependent]!.text,
                ),
        );
        const subject = s.graph.find(
            (edge) => edge.head === root.dependent && subjectRelation(edge.relation),
        );
        if (
            !marker ||
            !subject ||
            !stableEdge(s, root) ||
            !stableEdge(s, marker) ||
            !stableEdge(s, subject) ||
            !clauseFinite(s, root.dependent) ||
            s.tokens[marker.dependent]!.start > s.tokens[subject.dependent]!.start ||
            // A separate finite clause can supply the main clause, even when
            // the parser chose the subordinate predicate as the root.
            s.graph.some(
                (edge) =>
                    (subjectRelation(edge.relation) &&
                        edge.head !== root.dependent &&
                        clauseFinite(s, edge.head)) ||
                    // Imperative main clauses can have no explicit subject.
                    (["advcl", "conj", "parataxis", "ccomp"].includes(edge.relation) &&
                        edge.dependent !== root.dependent &&
                        clauseFinite(s, edge.dependent)),
            ) ||
            /[?!:;—–]/u.test(s.text)
        )
            return [];
        // "After that time ..." and "Since that day ..." are prepositional
        // adverbials with a following main clause, not subordinate clauses.
        // The parser can still attach "that" as a mark. Keep the error when
        // "that" is followed by another determiner ("since that the plot").
        const markerText = s.tokens[marker.dependent]!.text.toLowerCase(),
            afterMarker = s.tokens[marker.dependent + 1],
            afterThat = s.tokens[marker.dependent + 2];
        if (
            /^(after|before|since)$/u.test(markerText) &&
            afterMarker?.text.toLowerCase() === "that" &&
            afterThat &&
            !/^(the|a|an|this|these|those)$/iu.test(afterThat.text) &&
            (afterThat.pos === "NOUN" ||
                afterThat.pos === "PROPN" ||
                /^(my|your|his|her|its|our|their)$/iu.test(afterThat.text))
        )
            return [];
        return [
            finding(
                s,
                this.id,
                this.skill,
                s,
                "Grammar",
                "Review this dependent clause as a sentence",
                "The parse identifies a finite clause introduced by a subordinating marker, without an independent main clause. Join it to its main clause if a complete prose sentence is intended. Answers, headings, and deliberate fragments may stand alone.",
                [],
                "Possible issue",
                [
                    {
                        start: s.tokens[marker.dependent]!.start,
                        end: s.tokens[marker.dependent]!.end,
                        label: "Subordinating marker",
                    },
                    {
                        start: s.tokens[root.dependent]!.start,
                        end: s.tokens[root.dependent]!.end,
                        label: "Dependent predicate",
                    },
                ],
            ),
        ];
    },
};
const parallel: GrammarRule = {
    id: "parallel-forms",
    version: "1.0.0",
    skill: "verb-forms",
    description: "Verb-form parallelism within a shared governed coordination",
    evaluate(s) {
        if (s.ambiguous || hasQuotes(s)) return [];
        return s.graph
            .filter((e) => e.relation === "conj")
            .flatMap((edge) => {
                const head = s.tokens[edge.head]!,
                    dependent = s.tokens[edge.dependent]!;
                const governor = s.graph.find(
                    (e) => e.dependent === edge.head && ["xcomp", "obj"].includes(e.relation),
                );
                if (
                    !governor ||
                    !stableEdge(s, edge) ||
                    !/^(enjoy|avoid|consider|finish)$/iu.test(
                        s.tokens[governor.head]!.analyses.find((a) => a.pos === "VERB")?.lemma ??
                            "",
                    ) ||
                    !s.graph.some(
                        (e) => e.relation === "cc" && [edge.head, edge.dependent].includes(e.head),
                    ) ||
                    s.graph.some((e) => e.head === edge.dependent && subjectRelation(e.relation))
                )
                    return [];
                const form = (token: Token) => {
                    const forms = [
                        ...new Set(
                            token.analyses
                                .filter((a) => a.pos === "VERB")
                                .map((a) =>
                                    a.verbForm === "Inf"
                                        ? "infinitive"
                                        : /^(Part|Ger)$/u.test(a.verbForm ?? "") &&
                                            /ing$/iu.test(token.text)
                                          ? "gerund"
                                          : undefined,
                                ),
                        ),
                    ];
                    return forms.length === 1 ? forms[0] : undefined;
                };
                const formA = form(head),
                    formB = form(dependent);
                if (
                    !formA ||
                    !formB ||
                    formA === formB ||
                    !s.graph.some(
                        (e) =>
                            [edge.head, edge.dependent].includes(e.head) &&
                            e.relation === "mark" &&
                            s.tokens[e.dependent]!.text.toLowerCase() === "to",
                    )
                )
                    return [];
                return [
                    finding(
                        s,
                        this.id,
                        this.skill,
                        dependent,
                        "Grammar",
                        "Check the parallel verb forms",
                        `“${head.text}” and “${dependent.text}” share a governing construction but have different verb forms. Check whether both items should follow the same pattern.`,
                        [],
                        "Possible issue",
                        [
                            { start: head.start, end: head.end, label: formA },
                            { start: dependent.start, end: dependent.end, label: formB },
                        ],
                    ),
                ];
            });
    },
};
const modifier: GrammarRule = {
    id: "modifier-attachment",
    version: "1.0.0",
    skill: "sentence",
    description: "Potential dangling introductory participles with explicit inanimate subjects",
    evaluate(s) {
        if (s.ambiguous || hasQuotes(s)) return [];
        const opening = s.graph.find((e) => e.relation === "advcl" && e.dependent < e.head);
        if (!opening || !stableEdge(s, opening) || opening.dependent > 2) return [];
        const action = s.tokens[opening.dependent]!;
        if (
            action.pos !== "VERB" ||
            !action.analyses.some(
                (a) =>
                    a.pos === "VERB" &&
                    /^(Part|Ger)$/u.test(a.verbForm ?? "") &&
                    /^(walk|read|write|analyze|examine|study|review)$/u.test(a.lemma),
            ) ||
            s.graph.some(
                (e) => e.head === opening.dependent && /^(nsubj|csubj)(:|$)/u.test(e.relation),
            )
        )
            return [];
        const subject = s.graph.find((e) => e.head === opening.head && e.relation === "nsubj");
        if (
            !subject ||
            !/^(report|result|experiment|data|conclusion|essay|evidence)$/iu.test(
                s.tokens[subject.dependent]!.analyses.find((a) => a.pos === "NOUN")?.lemma ?? "",
            ) ||
            !s.tokens.some(
                (t) =>
                    t.text === "," &&
                    t.start > action.end &&
                    t.end <= s.tokens[subject.dependent]!.start,
            )
        )
            return [];
        return [
            finding(
                s,
                this.id,
                this.skill,
                s.tokens[opening.dependent]!,
                "Grammar",
                "Check who performs the opening action",
                "An introductory participial clause normally relates to the main-clause subject. This parse links the opening action to an inanimate subject; check the intended actor rather than accepting an automatic rewrite.",
                [],
                "Possible issue",
                [
                    {
                        start: s.tokens[opening.dependent]!.start,
                        end: s.tokens[opening.dependent]!.end,
                        label: "Opening action",
                    },
                    {
                        start: s.tokens[subject.dependent]!.start,
                        end: s.tokens[subject.dependent]!.end,
                        label: "Main-clause subject",
                    },
                ],
            ),
        ];
    },
};
const neuralAgreement = (inflections?: PresentVerbInflections): GrammarRule => ({
    id: "neural-agreement",
    version: "1.0.0",
    skill: "agreement",
    description:
        "Finite lexical and auxiliary agreement over UD subjects and copula/auxiliary edges",
    evaluate(s) {
        if (s.ambiguous || s.syntaxSource !== "neural") return [];
        const quotes = quoteRanges(s.text);
        return s.graph
            .filter((e) => ["nsubj", "nsubj:pass"].includes(e.relation))
            .flatMap((edge) => {
                const subject = s.tokens[edge.dependent]!;
                const hasCoordination = s.graph.some(
                    (candidate) =>
                        candidate.relation === "conj" &&
                        (candidate.head === edge.dependent ||
                            candidate.dependent === edge.dependent),
                );
                const coordinatedNumber = coordinatedSubjectNumber(s, edge.dependent);
                if (
                    !stableEdge(s, edge) ||
                    (hasCoordination && !coordinatedNumber) ||
                    /^(there|who|what|which|none|all|some|most|data|news|series|species|means|police|staff|team|family|committee|number|lot|percent|pair|part|half|majority|people|cattle|fish|sheep|deer|offspring)$/iu.test(
                        subject.text,
                    )
                )
                    return [];
                // Agreement on a nonfinite auxiliary, or in a mandative clause, is not licensed.
                if (
                    s.graph.some(
                        (e) =>
                            e.head === edge.head &&
                            e.relation === "aux" &&
                            /^(can|could|will|would|shall|should|must|may|might)$/iu.test(
                                s.tokens[e.dependent]!.text,
                            ),
                    ) ||
                    s.graph.some(
                        (e) =>
                            e.dependent === edge.head &&
                            e.relation === "ccomp" &&
                            s.tokens[e.head]!.analyses.some((a) =>
                                /^(suggest|recommend|insist|demand|require|ask|urge|propose)$/u.test(
                                    a.lemma,
                                ),
                            ),
                    )
                )
                    return [];
                const number = coordinatedNumber ?? grammaticalNumber(subject);
                if (!number) return [];
                const auxiliaries = s.graph
                    .filter(
                        (e) =>
                            e.head === edge.head && ["cop", "aux", "aux:pass"].includes(e.relation),
                    )
                    .map((e) => e.dependent);
                // A finite auxiliary carries the agreement; its lexical complement stays nonfinite.
                const finiteAuxiliaries = auxiliaries.filter((index) =>
                    parsedFinitePredicate(s, index),
                );
                const verbIndices = finiteAuxiliaries.length
                    ? finiteAuxiliaries
                          .slice()
                          .sort((a, b) => a - b)
                          .slice(0, 1)
                    : [edge.head];
                return verbIndices.flatMap((index) => {
                    const verb = s.tokens[index]!,
                        word = verb.text.toLowerCase();
                    if (tokenIsQuoted(s, verb, quotes) || isSubjunctiveWere(s, edge.head, verb))
                        return [];
                    const replacements: Record<string, string> =
                        subject.text.toLowerCase() === "i"
                            ? { is: "am", are: "am", were: "was", has: "have", does: "do" }
                            : number === "plural" || subject.text.toLowerCase() === "you"
                              ? { is: "are", was: "were", has: "have", does: "do" }
                              : { are: "is", were: "was", have: "has", do: "does" };
                    let replacement = replacements[word];
                    const singularThird =
                        number === "singular" && !/^(i|you)$/iu.test(subject.text);
                    if (!replacement && verb.pos === "VERB") {
                        replacement = inflections?.candidate(
                            verb,
                            singularThird ? "singular" : "plural",
                            parsedFinitePredicate(s, index),
                        );
                    }
                    if (!replacement || !parsedFinitePredicate(s, index)) return [];
                    return [
                        finding(
                            s,
                            this.id,
                            this.skill,
                            verb,
                            "Grammar",
                            "Review the parsed subject–verb agreement",
                            `The neural parse connects “${subject.text}” to the predicate containing “${verb.text}”. Its unambiguous lexical number suggests “${replacement}”. Review the parse and intended meaning before applying.`,
                            [
                                /^[A-Z]/u.test(verb.text)
                                    ? replacement[0]!.toUpperCase() + replacement.slice(1)
                                    : replacement,
                            ],
                            "Possible issue",
                            [
                                {
                                    start: subject.start,
                                    end: subject.end,
                                    label: "Parsed grammatical subject",
                                },
                                {
                                    start: verb.start,
                                    end: verb.end,
                                    label: "Finite verb, auxiliary, or copula",
                                },
                            ],
                        ),
                    ];
                });
            });
    },
});
const neuralPerfectForm = (inflections?: PastParticipleInflections): GrammarRule => ({
    id: "neural-perfect-form",
    version: "1.0.0",
    skill: "verb-forms",
    description: "Observed past-participle paradigms after a parsed perfect auxiliary",
    evaluate(s) {
        if (!inflections || s.ambiguous || s.syntaxSource !== "neural" || hasQuotes(s)) return [];
        return s.graph.flatMap((edge) => {
            if (!["aux", "aux:pass"].includes(edge.relation) || !stableEdge(s, edge)) return [];
            const auxiliary = s.tokens[edge.dependent]!;
            const predicate = s.tokens[edge.head]!;
            const auxiliaryLemma = auxiliary.analyses
                .filter((analysis) => analysis.pos === "AUX")
                .map((analysis) => analysis.lemma.toLowerCase());
            const licensedAuxiliary =
                (edge.relation === "aux" &&
                    (auxiliary.text.toLowerCase() === "have" || auxiliaryLemma.includes("have"))) ||
                (edge.relation === "aux:pass" &&
                    (auxiliary.text.toLowerCase() === "be" || auxiliaryLemma.includes("be")));
            if (auxiliary.pos !== "AUX" || !licensedAuxiliary || predicate.pos !== "VERB")
                return [];
            const replacement = inflections.candidate(predicate);
            if (!replacement) return [];
            return [
                finding(
                    s,
                    this.id,
                    this.skill,
                    predicate,
                    "Grammar",
                    "Check the verb form after the auxiliary",
                    `The parsed perfect or passive auxiliary “${auxiliary.text}” takes a past participle. The local training lexicon attests “${replacement}” as the unambiguous participle for this verb; review the parse before applying it.`,
                    [replacement],
                    "Possible issue",
                    [
                        { start: auxiliary.start, end: auxiliary.end, label: "Perfect auxiliary" },
                        { start: predicate.start, end: predicate.end, label: "Verb form" },
                    ],
                ),
            ];
        });
    },
});
const modalAuxiliaries = new Set([
    "can",
    "could",
    "may",
    "might",
    "must",
    "shall",
    "should",
    "will",
    "would",
]);
const neuralModalForm = (inflections?: PastParticipleInflections): GrammarRule => ({
    id: "neural-modal-form",
    version: "1.0.0",
    skill: "verb-forms",
    description: "Corpus-attested infinitive forms after parsed modal auxiliaries",
    evaluate(s) {
        if (!inflections || s.ambiguous || s.syntaxSource !== "neural" || hasQuotes(s)) return [];
        return s.graph.flatMap((edge) => {
            if (edge.relation !== "aux" || !stableEdge(s, edge)) return [];
            const predicate = s.tokens[edge.head]!;
            const modal = s.tokens[edge.dependent]!;
            const modalLemma = modal.analyses
                .filter((analysis) => analysis.pos === "AUX")
                .map((analysis) => analysis.lemma.toLowerCase());
            if (
                !(predicate.pos === "VERB" || predicate.pos === "AUX") ||
                !(
                    modalAuxiliaries.has(modal.text.toLowerCase()) ||
                    modalLemma.some((lemma) => modalAuxiliaries.has(lemma))
                )
            )
                return [];
            const auxiliaryChildren = s.graph.filter(
                (candidate) =>
                    candidate.head === edge.head &&
                    ["aux", "aux:pass", "cop"].includes(candidate.relation),
            );
            if (
                auxiliaryChildren.some(
                    (candidate) =>
                        candidate.dependent !== edge.dependent && !stableEdge(s, candidate),
                )
            )
                return [];
            const chain = auxiliaryChildren
                .filter((candidate) => candidate.dependent !== edge.dependent)
                .map((candidate) => s.tokens[candidate.dependent]!);
            const firstFollowingAuxiliary = chain
                .filter(
                    (candidate) => candidate.start > modal.end && candidate.end < predicate.start,
                )
                .sort((left, right) => left.start - right.start)[0];
            const targets = firstFollowingAuxiliary ? [firstFollowingAuxiliary] : [predicate];
            return targets.flatMap((target) => {
                const replacement = inflections.baseForm(target);
                if (!replacement) return [];
                return [
                    finding(
                        s,
                        this.id,
                        this.skill,
                        target,
                        "Grammar",
                        "Use the base verb after a modal",
                        `The parse attaches modal “${modal.text}” to this auxiliary chain. The local training lexicon attests “${replacement}” as the unambiguous infinitive for “${target.text}”; check the parse before applying it.`,
                        [replacement],
                        "Possible issue",
                        [
                            { start: modal.start, end: modal.end, label: "Parsed modal auxiliary" },
                            {
                                start: target.start,
                                end: target.end,
                                label: "Verb in the modal chain",
                            },
                        ],
                    ),
                ];
            });
        });
    },
});
const gerundComplement: GrammarRule = {
    id: "gerund-complement",
    version: "1.0.0",
    skill: "verb-forms",
    description: "Review a stable to-infinitive complement immediately after enjoy or avoid.",
    evaluate(s) {
        if (s.ambiguous || s.syntaxSource !== "neural" || hasQuotes(s)) return [];
        return s.graph.flatMap((edge) => {
            if (edge.relation !== "xcomp" || !stableEdge(s, edge)) return [];
            const governor = s.tokens[edge.head]!;
            const complement = s.tokens[edge.dependent]!;
            const marker = s.tokens[edge.head + 1];
            const governingForms = governor.analyses.filter((a) => a.pos === "VERB");
            const complementForms = complement.analyses.filter((a) => a.pos === "VERB");
            if (
                governor.pos !== "VERB" ||
                !finite(governor) ||
                !governingForms.length ||
                !governingForms.every((a) => /^(enjoy|avoid)$/u.test(a.lemma)) ||
                new Set(governingForms.map((a) => a.lemma)).size !== 1 ||
                complement.pos !== "VERB" ||
                !complementForms.some((a) => a.verbForm === "Inf") ||
                complementForms.some(
                    (a) => /^(Part|Ger)$/u.test(a.verbForm ?? "") || a.tense === "Past",
                ) ||
                new Set(complementForms.map((a) => a.lemma)).size !== 1 ||
                edge.dependent !== edge.head + 2 ||
                marker?.text.toLowerCase() !== "to" ||
                !/^\s+$/u.test(s.text.slice(governor.end - s.start, marker.start - s.start)) ||
                !/^\s+$/u.test(s.text.slice(marker.end - s.start, complement.start - s.start)) ||
                !s.graph.some(
                    (candidate) =>
                        candidate.head === edge.dependent &&
                        candidate.dependent === edge.head + 1 &&
                        candidate.relation === "mark" &&
                        stableEdge(s, candidate),
                ) ||
                s.graph.some(
                    (candidate) =>
                        candidate.head === edge.dependent && subjectRelation(candidate.relation),
                )
            )
                return [];
            return [
                finding(
                    s,
                    this.id,
                    this.skill,
                    { start: marker.start, end: complement.end },
                    "Grammar",
                    "Review the verb complement after enjoy or avoid",
                    `The local parse treats “${marker.text} ${complement.text}” as the direct verb complement of “${governor.text}”. In ordinary edited English, enjoy and avoid normally take an -ing complement. Check the intended construction and voice before revising; this observation supplies no automatic rewrite.`,
                    [],
                    "Possible issue",
                    [
                        { start: governor.start, end: governor.end, label: "Governing verb" },
                        {
                            start: marker.start,
                            end: complement.end,
                            label: "Parsed infinitive complement",
                        },
                    ],
                ),
            ];
        });
    },
};
const clausePunctuation: GrammarRule = {
    id: "clause-punctuation",
    version: "1.0.0",
    skill: "punctuation",
    description:
        "Initial finite adverbial clauses and punctuation splitting parsed complements or predicates.",
    evaluate(s) {
        if (s.ambiguous || s.syntaxSource !== "neural" || hasQuotes(s)) return [];
        const results: Diagnostic[] = [];
        for (const edge of s.graph) {
            if (!stableEdge(s, edge)) continue;
            const head = s.tokens[edge.head]!,
                dependent = s.tokens[edge.dependent]!;
            if (
                edge.relation === "advcl" &&
                edge.dependent < edge.head &&
                finite(dependent) &&
                s.graph.some((e) => e.head === edge.dependent && subjectRelation(e.relation))
            ) {
                const subject = s.graph.find(
                    (e) => e.head === edge.head && subjectRelation(e.relation),
                );
                const marker = s.graph.find(
                    (e) =>
                        e.head === edge.dependent &&
                        e.relation === "mark" &&
                        /^(although|because|when|while|unless|after|before|since|if)$/iu.test(
                            s.tokens[e.dependent]!.text,
                        ),
                );
                if (
                    !subject ||
                    !marker ||
                    marker.dependent !== 0 ||
                    dependent.end >= s.tokens[subject.dependent]!.start
                )
                    continue;
                // Follow the subordinate subtree rather than guessing that its verb ends the clause.
                const members = new Set([edge.dependent]);
                for (let pass = 0, changed = true; changed && pass < s.tokens.length; pass++) {
                    changed = false;
                    for (const child of s.graph)
                        if (
                            members.has(child.head) &&
                            !members.has(child.dependent) &&
                            child.relation !== "root"
                        ) {
                            members.add(child.dependent);
                            changed = true;
                        }
                }
                const end = Math.max(...[...members].map((i) => s.tokens[i]!.end));
                const mainSubject = s.tokens[subject.dependent]!;
                if (
                    end > mainSubject.start ||
                    s.tokens.some(
                        (t) =>
                            t.start >= dependent.end &&
                            t.end <= mainSubject.start &&
                            /[,;:—]/u.test(t.text),
                    )
                )
                    continue;
                results.push(
                    finding(
                        s,
                        "introductory-clause-comma",
                        this.skill,
                        { start: end, end },
                        "Punctuation",
                        "Review the boundary after the introductory clause",
                        "The parse identifies an opening subordinate clause with its own subject and finite verb. A comma normally separates it from the main clause; very short introductions may vary.",
                        [","],
                        "Possible issue",
                        [
                            {
                                start: s.tokens[marker.dependent]!.start,
                                end,
                                label: "Opening subordinate clause",
                            },
                            { start: mainSubject.start, end: head.end, label: "Main clause" },
                        ],
                    ),
                );
            }
            if (
                edge.relation === "obj" &&
                finite(head) &&
                head.end <= dependent.start &&
                /^(include|includes|included|need|needs|needed)$/iu.test(head.text) &&
                s.graph.some((e) => e.head === edge.head && subjectRelation(e.relation))
            ) {
                const index = s.tokens.indexOf(head),
                    colon = s.tokens[index + 1];
                if (
                    colon?.text !== ":" ||
                    colon.start >= dependent.start ||
                    s.tokens.filter((t) => t.text === ":").length !== 1 ||
                    !s.tokens.some((t) => t.text === "," && t.start > colon.start)
                )
                    continue;
                results.push(
                    finding(
                        s,
                        "colon-complement",
                        this.skill,
                        colon,
                        "Punctuation",
                        "Review the colon before the verb’s object",
                        "This parse puts the list directly in the verb’s object position. In ordinary prose, a colon normally follows a complete introduction rather than separating this verb from its object. Headings may differ.",
                        [""],
                        "Possible issue",
                        [
                            {
                                start: head.start,
                                end: head.end,
                                label: "Verb requiring its object",
                            },
                            {
                                start: dependent.start,
                                end: dependent.end,
                                label: "Parsed object after the colon",
                            },
                        ],
                    ),
                );
            }
            if (
                edge.relation === "conj" &&
                finite(head) &&
                finite(dependent) &&
                edge.head < edge.dependent &&
                s.graph.some((e) => e.head === edge.head && subjectRelation(e.relation)) &&
                !s.graph.some((e) => e.head === edge.dependent && subjectRelation(e.relation)) &&
                !s.tokens.some((t) => t.text === ",") &&
                s.tokens.filter((t) => t.text === ";").length === 1
            ) {
                const coordinator = s.graph.find(
                    (e) =>
                        [edge.head, edge.dependent].includes(e.head) &&
                        e.relation === "cc" &&
                        /^(and|but|or)$/iu.test(s.tokens[e.dependent]!.text),
                );
                const semicolon = s.tokens.find(
                    (t) => t.text === ";" && t.start >= head.end && t.end < dependent.start,
                );
                if (
                    !coordinator ||
                    !semicolon ||
                    s.tokens[coordinator.dependent]!.start < semicolon.end
                )
                    continue;
                results.push(
                    finding(
                        s,
                        "semicolon-shared-subject",
                        this.skill,
                        semicolon,
                        "Punctuation",
                        "Review the semicolon inside the shared predicate",
                        "The coordinated verbs share one parsed subject. A semicolon usually joins independent clauses; a simple shared-subject predicate normally needs no semicolon. Deliberate rhetorical pauses may differ.",
                        [""],
                        "Possible issue",
                        [
                            { start: head.start, end: head.end, label: "First predicate" },
                            {
                                start: dependent.start,
                                end: dependent.end,
                                label: "Predicate sharing the subject",
                            },
                        ],
                    ),
                );
            }
        }
        return results;
    },
};

const seriesComma: GrammarRule = {
    id: "missing-series-comma",
    version: "1.0.0",
    skill: "punctuation",
    description: "Missing commas between stable, parsed noun conjuncts in a series.",
    evaluate(s) {
        if (s.ambiguous || hasQuotes(s)) return [];
        const edges = s.graph.filter(
            (edge) =>
                edge.relation === "conj" &&
                stableEdge(s, edge) &&
                ["NOUN", "PROPN"].includes(s.tokens[edge.head]!.pos) &&
                ["NOUN", "PROPN"].includes(s.tokens[edge.dependent]!.pos),
        );
        const neighbors = new Map<number, Set<number>>();
        for (const edge of edges) {
            const left = neighbors.get(edge.head) ?? new Set<number>();
            const right = neighbors.get(edge.dependent) ?? new Set<number>();
            left.add(edge.dependent);
            right.add(edge.head);
            neighbors.set(edge.head, left);
            neighbors.set(edge.dependent, right);
        }
        const visited = new Set<number>();
        const results: Diagnostic[] = [];
        for (const start of neighbors.keys()) {
            if (visited.has(start)) continue;
            const component: number[] = [];
            const pending = [start];
            visited.add(start);
            while (pending.length) {
                const current = pending.pop()!;
                component.push(current);
                for (const neighbor of neighbors.get(current) ?? [])
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        pending.push(neighbor);
                    }
            }
            const items = component.sort(
                (left, right) => s.tokens[left]!.start - s.tokens[right]!.start,
            );
            if (items.length < 3) continue;
            const hasCoordinator = s.graph.some(
                (edge) =>
                    edge.relation === "cc" &&
                    edges.some(
                        (coordination) =>
                            [coordination.head, coordination.dependent].includes(edge.head) ||
                            [coordination.head, coordination.dependent].includes(edge.dependent),
                    ) &&
                    /^(and|or|nor)$/iu.test(s.tokens[edge.dependent]!.text),
            );
            if (!hasCoordinator) continue;

            for (let i = 0; i < items.length - 1; i++) {
                const left = s.tokens[items[i]!]!;
                const right = s.tokens[items[i + 1]!]!;
                const between = s.tokens.filter(
                    (token) => token.start >= left.end && token.end <= right.start,
                );
                if (between.some((token) => token.text === "," || /^[;:.]$/u.test(token.text)))
                    continue;
                // The comma before a final coordinator is optional in common English styles.
                if (
                    i === items.length - 2 &&
                    between.some((token) => /^(and|or|nor)$/iu.test(token.text))
                )
                    continue;
                const at = left.end;
                results.push(
                    finding(
                        s,
                        this.id,
                        this.skill,
                        { start: at, end: at },
                        "Punctuation",
                        "Separate the items in this series",
                        "The parse groups at least three noun items in one coordinated series. A comma normally separates these early items; the comma before the final conjunction can vary by style.",
                        [","],
                        "Possible issue",
                        [
                            { start: left.start, end: left.end, label: "List item" },
                            { start: right.start, end: right.end, label: "Next list item" },
                        ],
                    ),
                );
            }
        }
        return results;
    },
};

export const advancedRules: readonly GrammarRule[] = [
    neuralAgreement(),
    neuralPerfectForm(),
    neuralModalForm(),
    gerundComplement,
    countNounNumber(),
    subjectCase,
    comparison,
    boundaries,
    subordinateFragments,
    parallel,
    modifier,
    clausePunctuation,
    seriesComma,
];

export function createAdvancedRules(
    inflections: PresentVerbInflections,
    pastParticiples?: PastParticipleInflections,
    countNouns?: CountNounInflections,
): readonly GrammarRule[] {
    return [
        neuralAgreement(inflections),
        neuralPerfectForm(pastParticiples),
        neuralModalForm(pastParticiples),
        countNounNumber(countNouns),
        ...advancedRules.filter(
            (rule) =>
                ![
                    "neural-agreement",
                    "neural-perfect-form",
                    "neural-modal-form",
                    "count-noun-number",
                ].includes(rule.id),
        ),
    ];
}

export function documentRelationships(
    sentences: readonly Sentence[],
    style: boolean,
    writingIntent: WritingIntent = "general",
): Diagnostic[] {
    const findings: Diagnostic[] = [];
    for (let i = 1; i < sentences.length; i++) {
        const current = sentences[i]!,
            previous = sentences[i - 1]!;
        const pronoun = current.tokens[0];
        if (
            style &&
            pronoun &&
            /^(he|she|it|they)$/iu.test(pronoun.text) &&
            !previous.ambiguous &&
            !current.ambiguous &&
            previous.syntaxSource === "neural" &&
            current.syntaxSource === "neural" &&
            !hasQuotes(previous) &&
            !hasQuotes(current) &&
            current.graph.some((e) => subjectRelation(e.relation) && e.dependent === 0)
        ) {
            const word = pronoun.text.toLowerCase();
            const person = (t: Token) =>
                t.pos === "PROPN" ||
                t.analyses.some(
                    (a) =>
                        a.pos === "NOUN" &&
                        /^(student|teacher|researcher|writer|reader|child|person|man|woman|boy|girl|scientist|doctor|nurse|parent|friend)$/u.test(
                            a.lemma,
                        ),
                );
            const antecedents = previous.graph
                .filter((e) => ["nsubj", "nsubj:pass", "obj", "iobj"].includes(e.relation))
                .map((e) => previous.tokens[e.dependent]!)
                .filter(
                    (t, index, all) =>
                        all.findIndex((other) => other.start === t.start) === index &&
                        ["NOUN", "PROPN"].includes(t.pos) &&
                        (word === "they"
                            ? t.analyses.some((a) => a.number === "plural") || person(t)
                            : t.analyses.some((a) => a.number === "singular") &&
                              (word === "it" ? !person(t) : person(t))),
                );
            if (antecedents.length > 1)
                findings.push(
                    finding(
                        current,
                        "pronoun-reference",
                        "pronouns",
                        pronoun,
                        "Style",
                        "Review the pronoun’s reference",
                        "The preceding sentence contains multiple grammatically compatible noun phrases. Context may resolve the reference; use the intended noun explicitly if a reader could be unsure.",
                        [],
                        "Style suggestion",
                        antecedents.map((t) => ({
                            start: t.start,
                            end: t.end,
                            label: "Possible preceding reference; compatibility is not identity",
                        })),
                    ),
                );
        }
        if (style) {
            const previousFinite = previous.tokens.filter((t) =>
                    t.analyses.some((a) => a.finite && a.tense),
                ),
                currentFinite = current.tokens.filter((t) =>
                    t.analyses.some((a) => a.finite && a.tense),
                );
            const past =
                previousFinite.length > 0 &&
                previousFinite.every((t) => t.analyses.some((a) => a.tense === "Past"));
            if (
                past &&
                currentFinite.some((t) => t.analyses.some((a) => a.tense === "Pres")) &&
                !/\b(now|today|always|generally|currently)\b/iu.test(current.text)
            ) {
                const observation =
                    writingIntent === "narrative" || writingIntent === "reflective"
                        ? "Narrative and reflective writing often shifts between remembered events and present-day reflection. Check whether the change marks that shift clearly."
                        : writingIntent === "professional-communication" ||
                            writingIntent === "informative" ||
                            writingIntent === "explanatory"
                          ? "A past-tense sentence is followed by present tense. This can be correct for a current fact or general process; check that the time relationship is clear for the reader."
                          : "A preceding sentence uses past tense and this one includes present tense. This may be intentional: check the time relationship in the passage before changing it.";
                findings.push(
                    finding(
                        current,
                        "document-tense",
                        "verb-forms",
                        currentFinite[0]!,
                        "Style",
                        "A passage changes tense",
                        observation,
                        [],
                        "Style suggestion",
                        [...previousFinite.slice(0, 2), ...currentFinite.slice(0, 2)].map((t) => ({
                            start: t.start,
                            end: t.end,
                            label: "Tense evidence in the passage",
                        })),
                    ),
                );
            }
        }
    }
    return findings;
}
