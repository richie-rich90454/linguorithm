import type { Diagnostic, Sentence, Token } from "./domain";
import { finding } from "./grammar";

const subjectRelations = new Set(["nsubj", "nsubj:pass"]);
const finite = (token: Token | undefined) =>
    token?.analyses.some(
        (analysis) => ["AUX", "VERB"].includes(analysis.pos) && analysis.finite === true,
    ) ?? false;

function hasFiniteSubject(sentence: Sentence): boolean {
    return sentence.graph.some((edge) => {
        if (!subjectRelations.has(edge.relation)) return false;
        if (finite(sentence.tokens[edge.head])) return true;
        return sentence.graph.some(
            (related) =>
                related.head === edge.head &&
                ["aux", "aux:pass", "cop"].includes(related.relation) &&
                finite(sentence.tokens[related.dependent]),
        );
    });
}

function startsWithListMarker(sentence: Sentence): boolean {
    return /^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)/u.test(sentence.text);
}

function firstWord(sentence: Sentence): Token | undefined {
    return sentence.tokens.find((token) => /\p{L}/u.test(token.text));
}

function hasOpeningQuote(sentence: Sentence): boolean {
    return /^\s*[“"']/u.test(sentence.text);
}

function isLowercaseStyle(sentences: readonly Sentence[]): boolean {
    const candidates = sentences.filter(
        (sentence) =>
            !startsWithListMarker(sentence) && !hasOpeningQuote(sentence) && firstWord(sentence),
    );
    if (candidates.length < 3) return false;
    const lowercase = candidates.filter((sentence) => {
        const word = firstWord(sentence)!.text;
        return word[0] === word[0]!.toLocaleLowerCase("en-US");
    }).length;
    return lowercase / candidates.length >= 0.75;
}

function sentenceConventions(sentences: readonly Sentence[]): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const lowercaseStyle = isLowercaseStyle(sentences);

    for (const sentence of sentences) {
        const first = firstWord(sentence);
        const listItem = startsWithListMarker(sentence);
        if (
            first &&
            !listItem &&
            !hasOpeningQuote(sentence) &&
            hasFiniteSubject(sentence) &&
            !lowercaseStyle &&
            first.text[0] === first.text[0]!.toLocaleLowerCase("en-US")
        ) {
            const replacement =
                first.text.toLowerCase() === "i"
                    ? "I"
                    : first.text[0]!.toLocaleUpperCase("en-US") + first.text.slice(1);
            findings.push(
                finding(
                    sentence,
                    "sentence-capitalization",
                    "punctuation",
                    first,
                    "Punctuation",
                    "Capitalize the sentence opening",
                    "This passage appears to begin a complete sentence with a lower-case word. A lower-case style can be intentional; keep the wording if that is the voice you chose.",
                    [replacement],
                    "Possible issue",
                ),
            );
        }

        const trimmed = sentence.text.trimEnd();
        const normalized = trimmed.replace(/[)\]}]+$/u, "");
        const opening = first?.text.toLowerCase() ?? "";
        if (
            sentence.tokens.length >= 3 &&
            hasFiniteSubject(sentence) &&
            !hasOpeningQuote(sentence) &&
            !listItem &&
            !/[.!?…;:]$/u.test(normalized) &&
            !/^(?:who|what|when|where|why|how|am|are|is|was|were|do|does|did|can|could|will|would|should|have|has|had)$/u.test(
                opening,
            )
        ) {
            const at = sentence.start + trimmed.length;
            findings.push(
                finding(
                    sentence,
                    "missing-terminal-mark",
                    "punctuation",
                    { start: at, end: at },
                    "Punctuation",
                    "Add an ending mark",
                    "The parsed text appears to be a complete statement without an ending mark. Add punctuation if the passage is intended as a sentence rather than a heading or list item.",
                    ["."],
                    "Possible issue",
                ),
            );
        }
    }
    return findings;
}

function styleSpacing(sentences: readonly Sentence[], text: string): Diagnostic[] {
    if (text.includes("```")) return [];
    const inlineCode: [number, number][] = [...text.matchAll(/`[^`]+`/gu)].map((match) => [
        match.index!,
        match.index! + match[0].length,
    ]);
    const findings: Diagnostic[] = [];
    for (const match of text.matchAll(/(\p{L})([ \t]{2,})(\p{L})/gu)) {
        const start = match.index! + match[1]!.length;
        const end = start + match[2]!.length;
        if (inlineCode.some(([left, right]) => start < right && end > left)) continue;
        const sentence = sentences.find((item) => item.start <= start && item.end >= end);
        if (!sentence) continue;
        const before = sentence.tokens.filter(
            (token) => token.pos !== "PUNCT" && token.end <= start,
        );
        const after = sentence.tokens.filter(
            (token) => token.pos !== "PUNCT" && token.start >= end,
        );
        const contextEnd = after[1]?.end ?? after[0]?.end ?? end;
        findings.push(
            finding(
                sentence,
                "repeated-spacing",
                "punctuation",
                { start, end },
                "Style",
                "Review the extra spacing",
                "More than one space separates these words. If the spacing is not intentional alignment, one space may make the passage easier to read.",
                [],
                "Style suggestion",
                [
                    {
                        start: before.at(-1)?.start ?? start,
                        end: contextEnd,
                        label: "Repeated inter-word spacing",
                    },
                ],
            ),
        );
    }
    return findings;
}

export function documentFeedback(
    sentences: readonly Sentence[],
    text: string,
    style: boolean,
): Diagnostic[] {
    return [...sentenceConventions(sentences), ...(style ? styleSpacing(sentences, text) : [])];
}
