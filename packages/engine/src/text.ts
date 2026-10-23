import type { Morphology, Pos, Sentence, Span, Token } from "./domain";

const words = (text: string): Set<string> => new Set(text.split(" "));
const pronouns = words(
    "i you he she it we they me him her us them who whom someone somebody everyone everybody anyone anybody nobody each neither either this that these those",
);
const determiners = words("a an the my your his her its our their some any every each no");
const prepositions = words(
    "of in on at by for with from to over under through between among near across about without during",
);
const auxiliaries = words(
    "am is are was were be been being has have had do does did can could will would shall should may might must",
);
const verbs = words(
    "walk walks run runs eat eats write writes read reads work works study studies think thinks know knows see sees make makes go goes say says mean means play plays seem seems become becomes need needs use uses find finds help helps learn learns show shows give gives take takes like likes live lives believe believes support supports explain explains improve improves collect collects matter matters depend depends contain contains arrive arrives look looks wait waits grow grows sing sings dance dances enjoy enjoys discuss discusses suggest suggests provide provides begin begins revise revises notice notices reveal reveals observe observes",
);
const irregular: Record<string, string> = {
    was: "be",
    were: "be",
    is: "be",
    are: "be",
    am: "be",
    been: "be",
    went: "go",
    gone: "go",
    wrote: "write",
    written: "write",
    ate: "eat",
    eaten: "eat",
    saw: "see",
    seen: "see",
    did: "do",
    done: "do",
    had: "have",
    has: "have",
    children: "child",
    people: "person",
    men: "man",
    women: "woman",
    mice: "mouse",
    feet: "foot",
    teeth: "tooth",
};
const adjectives = words(
    "good bad great small large new old clear important interesting difficult beautiful possible different common local full many few little much happy tired ready careful thoughtful curious useful",
);
const conjunctions = words("and but or nor yet so");
const countNouns = words(
    "student teacher researcher writer reader child person man woman mouse foot tooth collection essay book laboratory experiment result detail word sentence paragraph clause verb noun pronoun adjective adverb subject object rule note notebook idea question answer reason letter desk shelf school house dog cat apple orange egg hour university explanation example theory observation finding opportunity lesson source phrase project team group pair number hypothesis road route trial conclusion evidence",
);
const massNouns = words(
    "research grammar writing punctuation knowledge information work practice science language education time news physics mathematics linguistics economics politics statistics gas chaos basis analysis",
);
const subordinators = words(
    "because although if when while unless since before after though whereas until",
);

export class MorphologyAnalyzer {
    constructor(private readonly lexicon?: Readonly<Record<string, readonly Morphology[]>>) {}
    analyze(surface: string): readonly Morphology[] {
        const w = surface.toLowerCase();
        if (this.lexicon && Object.hasOwn(this.lexicon, w)) return this.lexicon[w]!;
        if (/^[\p{P}\p{S}]+$/u.test(w)) return [{ lemma: w, pos: "PUNCT" }];
        if (/^\d/u.test(w)) return [{ lemma: w, pos: "NUM" }];
        if (pronouns.has(w))
            return [
                {
                    lemma: w,
                    pos: "PRON",
                    number: /^(we|they|us|them|these|those)$/u.test(w) ? "plural" : "singular",
                },
            ];
        if (auxiliaries.has(w))
            return [
                { lemma: irregular[w] ?? w, pos: "AUX", finite: !/^(be|been|being)$/u.test(w) },
            ];
        if (determiners.has(w)) return [{ lemma: w, pos: "DET" }];
        if (prepositions.has(w)) return [{ lemma: w, pos: "ADP" }];
        if (conjunctions.has(w)) return [{ lemma: w, pos: "CCONJ" }];
        if (subordinators.has(w)) return [{ lemma: w, pos: "SCONJ" }];
        if (adjectives.has(w)) return [{ lemma: w, pos: "ADJ" }];
        if (w.endsWith("ly")) return [{ lemma: w, pos: "ADV" }];
        const lemma =
            irregular[w] ??
            (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("s") ? w.slice(0, -1) : w);
        const noun: Morphology = {
            lemma,
            pos: "NOUN",
            number: massNouns.has(w)
                ? "singular"
                : countNouns.has(lemma) || countNouns.has(w)
                  ? (w.endsWith("s") && !w.endsWith("ss") && !/(?:sis|us)$/u.test(w)) ||
                    /^(children|people|men|women|mice|feet|teeth)$/u.test(w)
                      ? "plural"
                      : "singular"
                  : undefined,
        };
        if (
            verbs.has(w) ||
            /(?:ed|ing)$/u.test(w) ||
            (irregular[w] && !/^(children|people|men|women|mice|feet|teeth)$/u.test(w))
        )
            return [{ lemma, pos: "VERB", finite: !w.endsWith("ing") }, noun];
        return [noun, { lemma: w, pos: "X" }];
    }
}

export class Tokenizer {
    constructor(private readonly morphology = new MorphologyAnalyzer()) {}
    tokenize(text: string, offset = 0): Token[] {
        return [
            ...text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|\d+(?:[.,]\d+)*|[^\s]/gu),
        ].flatMap((m) => {
            const contraction = /^(.*?)(n['’]t|['’](?:m|re|ve|ll|d|s))$/iu.exec(m[0]);
            const parts = contraction?.[1] ? [contraction[1], contraction[2]!] : [m[0]];
            let position = offset + m.index;
            return parts.map((text) => {
                const analyses = this.morphology.analyze(text);
                const token = {
                    start: position,
                    end: position + text.length,
                    text,
                    analyses,
                    pos: analyses[0]!.pos,
                };
                position += text.length;
                return token;
            });
        });
    }
}

export function paragraphs(text: string): (Span & { text: string })[] {
    return [...text.matchAll(/[^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*/gu)].map((m) => ({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
    }));
}

export class SentenceSegmenter {
    segment(text: string, offset = 0): (Span & { text: string })[] {
        // Intl.Segmenter implements Unicode boundaries, then we merge abbreviation/initial splits.
        const parts = [...new Intl.Segmenter("en-US", { granularity: "sentence" }).segment(text)];
        const result: (Span & { text: string })[] = [];
        let start = 0;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            const end = part.index + part.segment.length;
            if (
                i + 1 < parts.length &&
                /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z])\.\s*$/u.test(
                    text.slice(start, end),
                )
            )
                continue;
            const chunk = text.slice(start, end);
            const leading = chunk.length - chunk.trimStart().length;
            const trimmed = chunk.trim();
            if (trimmed)
                result.push({
                    start: offset + start + leading,
                    end: offset + start + leading + trimmed.length,
                    text: trimmed,
                });
            start = end;
        }
        return result;
    }
}

export interface PartOfSpeechTagger {
    tag(tokens: readonly Token[]): readonly Token[];
}
export class LexicalTagger implements PartOfSpeechTagger {
    tag(tokens: readonly Token[]): readonly Token[] {
        return tokens.map((token, i) => {
            const previous = tokens[i - 1];
            let pos: Pos = token.pos;
            if (
                (previous?.pos === "DET" || previous?.pos === "ADJ") &&
                token.analyses.some((a) => a.pos === "NOUN")
            )
                pos = "NOUN";
            if (
                i === 0 &&
                token.text.toLowerCase().endsWith("ing") &&
                tokens[1]?.analyses.some((a) => a.finite)
            )
                pos = "NOUN";
            return { ...token, pos };
        });
    }
}

export interface DependencyParser {
    parse(tokens: readonly Token[]): { graph: Sentence["graph"]; ambiguous: boolean };
}
export class ConservativeDependencyParser implements DependencyParser {
    parse(tokens: readonly Token[]): { graph: Sentence["graph"]; ambiguous: boolean } {
        const verb = tokens.findIndex(
            (t) => (t.pos === "VERB" || t.pos === "AUX") && t.analyses.some((a) => a.finite),
        );
        if (verb < 0) return { graph: [], ambiguous: true };
        // Skip prepositional phrases and relative clauses when locating the matrix subject.
        let subject = -1;
        let embedded = false;
        for (let i = 0; i < verb; i++) {
            const t = tokens[i]!;
            if (t.pos === "ADP" || (/^(who|which|that)$/iu.test(t.text) && subject >= 0))
                embedded = true;
            if (t.text === ",") embedded = false;
            if (!embedded && (t.pos === "PRON" || t.pos === "NOUN")) subject = i;
        }
        const graph: Sentence["graph"][number][] = [
            { head: verb, dependent: verb, relation: "root" },
        ];
        if (subject >= 0) graph.push({ head: verb, dependent: subject, relation: "nsubj" });
        let preposition = -1;
        for (let i = 0; i < tokens.length; i++) {
            if (i === verb) {
                preposition = -1;
                continue;
            }
            if (i === subject) continue;
            const t = tokens[i]!;
            if (t.pos === "PUNCT" || t.pos === "CCONJ") preposition = -1;
            let head = verb;
            if (t.pos === "DET") {
                for (let next = i + 1; next < Math.min(tokens.length, i + 5); next++) {
                    if (tokens[next]!.pos === "NOUN" || tokens[next]!.pos === "PRON") {
                        head = next;
                        break;
                    }
                    if (tokens[next]!.pos !== "ADJ") break;
                }
            }
            if (t.pos === "NOUN" && preposition >= 0) head = preposition;
            if (t.pos === "ADP") {
                if (i < verb && subject >= 0) head = subject;
                preposition = i;
            }
            graph.push({
                head,
                dependent: i,
                relation:
                    t.pos === "PUNCT"
                        ? "punct"
                        : t.pos === "ADP"
                          ? "prep"
                          : t.pos === "DET"
                            ? "det"
                            : (i > verb || preposition >= 0) && t.pos === "NOUN"
                              ? "obj"
                              : "dep",
            });
        }
        return {
            graph,
            ambiguous:
                subject < 0 ||
                tokens.some((t) => t.pos === "SCONJ" || /^(who|which)$/iu.test(t.text)),
        };
    }
}
