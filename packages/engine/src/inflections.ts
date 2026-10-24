import type { Morphology, Token } from "./domain";

type Number = "singular" | "plural";
type Forms = Readonly<Record<string, readonly Morphology[]>>;

/** Learns countable noun lemmas from observed plural forms in the local training lexicon. */
export class CountNounInflections {
    private readonly countableLemmas = new Set<string>();

    constructor(forms: Forms) {
        for (const analyses of Object.values(forms))
            for (const analysis of analyses)
                if (analysis.pos === "NOUN" && analysis.number === "plural")
                    this.countableLemmas.add(analysis.lemma.toLowerCase());
    }

    supports(token: Token): boolean {
        return (
            token.pos === "NOUN" &&
            token.analyses.some(
                (analysis) =>
                    analysis.pos === "NOUN" &&
                    this.countableLemmas.has(analysis.lemma.toLowerCase()),
            )
        );
    }
}

function verbAnalyses(analyses: readonly Morphology[]): readonly Morphology[] {
    return analyses.filter((analysis) => analysis.pos === "VERB" || analysis.pos === "AUX");
}

function present(analysis: Morphology): boolean {
    return analysis.finite === true && analysis.verbForm === "Fin" && analysis.tense === "Pres";
}

function lemmaOf(analyses: readonly Morphology[]): string | undefined {
    const verbs = verbAnalyses(analyses);
    const lemma = verbs[0]?.lemma;
    if (
        !lemma ||
        lemma === "be" ||
        verbs.some((analysis) => analysis.pos !== "VERB") ||
        analyses.some((analysis) => analysis.lemma !== lemma)
    )
        return undefined;
    return lemma;
}

function preserveCase(source: string, replacement: string): string | undefined {
    const lower = source.toLowerCase();
    if (source === lower) return replacement;
    if (source === lower.toUpperCase()) return replacement.toUpperCase();
    if (source === lower[0]!.toUpperCase() + lower.slice(1))
        return replacement[0]!.toUpperCase() + replacement.slice(1);
    return undefined;
}

function regularThirdPerson(lemma: string): string | undefined {
    if (!/^[a-z]+$/u.test(lemma)) return undefined;
    if (lemma.endsWith("iz")) return `${lemma}zes`;
    if (/(?:s|x|z|sh|ch|o)$/u.test(lemma)) return `${lemma}es`;
    if (lemma.length > 1 && lemma.endsWith("y") && !/[aeiou]y$/u.test(lemma))
        return `${lemma.slice(0, -1)}ies`;
    return `${lemma}s`;
}

/** Prefer observed corpus paradigms; use regular forms only with a finite parse and dictionary confirmation. */
export class PresentVerbInflections {
    private readonly paradigms = new Map<string, Record<Number, Set<string>>>();

    constructor(
        private readonly forms: Forms,
        private readonly isKnownWord?: (word: string) => boolean,
    ) {
        for (const [surface, analyses] of Object.entries(forms)) {
            const lemma = lemmaOf(analyses);
            if (!lemma || surface !== surface.toLowerCase()) continue;
            const verbs = verbAnalyses(analyses);
            // Infinitive alternatives are normal for base forms. Past and unknown finite
            // alternatives cannot establish a tense-preserving replacement.
            if (
                verbs.some(
                    (analysis) =>
                        analysis.tense === "Past" ||
                        (analysis.finite === true && !present(analysis)),
                )
            )
                continue;
            for (const analysis of verbs) {
                if (!present(analysis) || !analysis.number) continue;
                // Person disambiguates "I calibrate" from "she calibrates". Legacy
                // resources may only establish a non-base singular surface.
                if (
                    analysis.number === "singular" &&
                    (analysis.person !== undefined ? analysis.person !== 3 : surface === lemma)
                )
                    continue;
                let paradigm = this.paradigms.get(lemma);
                if (!paradigm) {
                    paradigm = { singular: new Set(), plural: new Set() };
                    this.paradigms.set(lemma, paradigm);
                }
                paradigm[analysis.number].add(surface);
            }
        }
    }

    candidate(
        token: Token,
        targetNumber: Number,
        parsedAsFinitePredicate = false,
    ): string | undefined {
        if (token.pos !== "VERB") return undefined;
        const surface = token.text.toLowerCase();
        const observed = this.forms[surface] ?? [];
        const observedLemma = lemmaOf(observed);
        const predictedLemma = lemmaOf(token.analyses);
        const lemma = predictedLemma;
        if (!lemma || (observedLemma && observedLemma !== lemma)) return undefined;
        const source = [...verbAnalyses(observed), ...verbAnalyses(token.analyses)];
        if (new Set(source.map((analysis) => analysis.lemma)).size !== 1) return undefined;
        const conflictsWithPresent = source.some(
            (analysis) =>
                analysis.pos === "VERB" &&
                (analysis.tense === "Past" ||
                    /^(Part|Ger)$/u.test(analysis.verbForm ?? "") ||
                    (analysis.finite === true &&
                        analysis.verbForm === "Fin" &&
                        !!analysis.tense &&
                        analysis.tense !== "Pres") ||
                    (analysis.finite === false &&
                        (analysis.verbForm !== "Inf" ||
                            (!!analysis.tense && analysis.tense !== "Pres")))),
        );
        if (conflictsWithPresent) return undefined;
        const isContextualInfinitive = (analysis: Morphology) =>
            parsedAsFinitePredicate &&
            analysis.pos === "VERB" &&
            analysis.finite === false &&
            analysis.verbForm === "Inf" &&
            (!analysis.tense || analysis.tense === "Pres");
        if (source.some(present)) {
            const hasInvalidSource = (analysis: Morphology) => {
                if (!present(analysis)) return !isContextualInfinitive(analysis);
                if (!analysis.number) return true;
                if (analysis.number === targetNumber) return true;
                // A base form is also a first- or second-person singular form. The
                // parsed subject resolves those readings for a third-person target.
                return (
                    analysis.number === "singular" &&
                    surface === lemma &&
                    (analysis.person !== undefined ? analysis.person !== 3 : true)
                );
            };
            if (!source.some(hasInvalidSource)) {
                const targets = this.paradigms.get(lemma)?.[targetNumber];
                if (targets?.size === 1) {
                    const replacement = targets.values().next().value;
                    if (replacement && replacement !== surface)
                        return preserveCase(token.text, replacement);
                }
            }
        }

        if (
            !parsedAsFinitePredicate ||
            !this.isKnownWord?.(surface) ||
            lemma === "be" ||
            lemma === "have" ||
            lemma === "do"
        )
            return undefined;
        const currentNumberIsUnambiguous = !source.some(
            (analysis) =>
                present(analysis) &&
                analysis.number === targetNumber &&
                !(analysis.number === "singular" && analysis.person !== 3 && surface === lemma),
        );
        if (!currentNumberIsUnambiguous) return undefined;
        const thirdPerson = regularThirdPerson(lemma);
        const replacement =
            targetNumber === "singular" && surface === lemma
                ? thirdPerson
                : targetNumber === "plural" && surface === thirdPerson
                  ? lemma
                  : undefined;
        if (!replacement || replacement === surface || !this.isKnownWord(replacement))
            return undefined;
        return preserveCase(token.text, replacement);
    }
}

function pastParticiple(analysis: Morphology): boolean {
    return analysis.pos === "VERB" && analysis.verbForm === "Part" && analysis.tense === "Past";
}

/** Supplies observed forms; the caller must establish a perfect auxiliary context. */
export class PastParticipleInflections {
    private readonly paradigms = new Map<string, Set<string>>();

    constructor(private readonly forms: Forms) {
        for (const [surface, analyses] of Object.entries(forms)) {
            const lemma = lemmaOf(analyses);
            if (!lemma || surface !== surface.toLowerCase() || !analyses.some(pastParticiple))
                continue;
            const surfaces = this.paradigms.get(lemma) ?? new Set<string>();
            surfaces.add(surface);
            this.paradigms.set(lemma, surfaces);
        }
    }

    candidate(token: Token): string | undefined {
        if (token.pos !== "VERB") return undefined;
        const surface = token.text.toLowerCase();
        if (!Object.hasOwn(this.forms, surface)) return undefined;
        const observed = this.forms[surface]!;
        const lemma = lemmaOf(observed);
        if (
            !lemma ||
            lemmaOf(token.analyses) !== lemma ||
            observed.some(pastParticiple) ||
            token.analyses.some(pastParticiple)
        )
            return undefined;
        const targets = this.paradigms.get(lemma);
        if (!targets || targets.size !== 1) return undefined;
        const replacement = targets.values().next().value;
        if (!replacement || replacement === surface) return undefined;
        return preserveCase(token.text, replacement);
    }
}
