import type { Material } from "./domain";

export interface SourceBlock {
    kind: "heading" | "paragraph" | "list" | "table" | "page";
    text: string;
    start: number;
    end: number;
    page?: number;
    level?: number;
    cells?: readonly (readonly string[])[];
}
const stopwords = new Set(
    "a an the is are was were be been being in on at of for to and or but with from by as it this that these those you your we our they their can will should has have had not no".split(
        " ",
    ),
);
const conceptPatterns: Record<string, RegExp> = {
    agreement: /subject[–— -]+verb agreement|verb agreement/iu,
    boundaries: /independent clause|dependent clause|comma splice|run.on|clause boundar/iu,
    punctuation: /comma|semicolon|colon|apostrophe|quotation/iu,
    "verb-forms": /past participle|verb form|perfect tense|modal|infinitive|gerund/iu,
    pronouns: /pronoun|antecedent|object case|subject case/iu,
    sentence: /subject|predicate|finite verb|fragment|sentence/iu,
    usage: /spelling|usage|article|word choice/iu,
};
export function sourceBlocks(text: string): SourceBlock[] {
    const result: SourceBlock[] = [];
    let page: number | undefined;
    for (const match of text.matchAll(/[^\r\n]+/gu)) {
        const line = match[0],
            pageMatch = /^\[Page (\d+)\]$/u.exec(line.trim()),
            heading = /^(#{1,6})\s+(.+)$/u.exec(line),
            list = /^\s*(?:[-*+] |\d+[.)] )/u.test(line);
        if (pageMatch) page = Number(pageMatch[1]);
        const cells = line.includes("|")
            ? line
                  .split("|")
                  .map((s) => s.trim())
                  .filter(Boolean)
            : undefined;
        result.push({
            kind: pageMatch
                ? "page"
                : heading
                  ? "heading"
                  : list
                    ? "list"
                    : cells && cells.length > 1
                      ? "table"
                      : "paragraph",
            text: line,
            start: match.index,
            end: match.index + line.length,
            page,
            level: heading?.[1]?.length,
            cells: cells && cells.length > 1 ? [cells] : undefined,
        });
    }
    return result;
}
export class MaterialExtractor {
    analyze(material: Pick<Material, "text">): {
        blocks: SourceBlock[];
        keyPhrases: { phrase: string; score: number; start: number; end: number }[];
        definitions: {
            term: string;
            definition: string;
            quote: string;
            start: number;
            end: number;
        }[];
        concepts: { skill: string; quote: string; start: number; end: number }[];
    } {
        const blocks = sourceBlocks(material.text);
        const frequency = new Map<string, number>(),
            degree = new Map<string, number>(),
            documentFrequency = new Map<string, number>();
        const candidates: { phrase: string; start: number; end: number; words: string[] }[] = [];
        for (const block of blocks) {
            const seen = new Set<string>();
            let phrase: { text: string; start: number; end: number }[] = [];
            const flush = () => {
                if (phrase.length && phrase.length <= 5) {
                    const words = phrase.map((w) => w.text);
                    candidates.push({
                        phrase: words.join(" "),
                        start: phrase[0]!.start,
                        end: phrase.at(-1)!.end,
                        words,
                    });
                    for (const word of words) {
                        frequency.set(word, (frequency.get(word) ?? 0) + 1);
                        degree.set(word, (degree.get(word) ?? 0) + words.length);
                        seen.add(word);
                    }
                }
                phrase = [];
            };
            for (const match of block.text.matchAll(/[\p{L}]+|[^\p{L}\s]+/gu)) {
                const word = match[0].toLowerCase();
                if (stopwords.has(word) || !/^\p{L}+$/u.test(word)) flush();
                else
                    phrase.push({
                        text: word,
                        start: block.start + match.index,
                        end: block.start + match.index + match[0].length,
                    });
            }
            flush();
            for (const word of seen)
                documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
        }
        const scored = candidates.map((candidate) => ({
            phrase: candidate.phrase,
            start: candidate.start,
            end: candidate.end,
            score: candidate.words.reduce(
                (sum, w) =>
                    sum +
                    (degree.get(w)! / frequency.get(w)!) *
                        (Math.log((blocks.length + 1) / ((documentFrequency.get(w) ?? 0) + 1)) + 1),
                0,
            ),
        }));
        const unique = new Map<string, (typeof scored)[number]>();
        for (const p of scored)
            if (!unique.has(p.phrase) || unique.get(p.phrase)!.score < p.score)
                unique.set(p.phrase, p);
        const definitions: ReturnType<MaterialExtractor["analyze"]>["definitions"] = [];
        for (const block of blocks) {
            const prefix = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?/u.exec(block.text)![0].length;
            const text = block.text.slice(prefix);
            const pattern =
                /(?:^|(?<=[.!?])\s+)(?:An?\s+)?([\p{L}][\p{L}\s–-]{1,60}?)\s+(?:is|means|refers to)\s+([^.!?\n]{8,300})|(?:^|(?<=[.!?])\s+)([\p{L}][\p{L}\s–-]{1,60}?)\s*[:—–]\s*([^.!?\n]{8,300})/giu;
            for (const match of text.matchAll(pattern)) {
                const term = (match[1] ?? match[3])!.trim(),
                    definition = (match[2] ?? match[4])!.trim(),
                    quote = match[0].trim(),
                    start = block.start + prefix + match.index + match[0].indexOf(quote);
                definitions.push({
                    term,
                    definition,
                    quote,
                    start,
                    end: start + quote.length,
                });
            }
        }
        const concepts = blocks.flatMap((block) =>
            Object.entries(conceptPatterns)
                .filter(([, pattern]) => pattern.test(block.text))
                .map(([skill]) => ({
                    skill,
                    quote: block.text,
                    start: block.start,
                    end: block.end,
                })),
        );
        return {
            blocks,
            keyPhrases: [...unique.values()]
                .sort((a, b) => b.score - a.score || a.start - b.start)
                .slice(0, 30),
            definitions,
            concepts,
        };
    }
}
