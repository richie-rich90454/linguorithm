// Non-generative contextual scoring. It ranks bounded candidates; it never writes prose.
export class NgramLanguageModel {
    private readonly unigrams = new Map<string, number>();
    private readonly bigrams = new Map<string, number>();
    constructor(
        sentences: readonly (readonly string[])[],
        private readonly smoothing = 0.1,
    ) {
        if (!(smoothing > 0)) throw new Error("Smoothing must be positive.");
        for (const sentence of sentences) {
            const words = ["<s>", ...sentence.map((w) => w.toLowerCase()), "</s>"];
            for (let i = 0; i < words.length; i++) {
                const word = words[i]!;
                this.unigrams.set(word, (this.unigrams.get(word) ?? 0) + 1);
                if (i > 0) {
                    const key = `${words[i - 1]}\0${word}`;
                    this.bigrams.set(key, (this.bigrams.get(key) ?? 0) + 1);
                }
            }
        }
    }
    score(tokens: readonly string[]): number {
        let result = 0;
        const words = ["<s>", ...tokens.map((t) => t.toLowerCase()), "</s>"];
        for (let i = 1; i < words.length; i++)
            result += Math.log(
                ((this.bigrams.get(`${words[i - 1]}\0${words[i]}`) ?? 0) + this.smoothing) /
                    ((this.unigrams.get(words[i - 1]!) ?? 0) +
                        this.smoothing * (this.unigrams.size + 1)),
            );
        return result;
    }
}

export function viterbi(
    emissions: readonly (readonly number[])[],
    transitions: readonly (readonly number[])[],
    startScores: readonly number[],
    endScores: readonly number[],
): number[] {
    const k = startScores.length;
    if (!emissions.length) return [];
    if (
        !k ||
        k > 100 ||
        emissions.length > 10_000 ||
        transitions.length !== k ||
        endScores.length !== k ||
        emissions.some((r) => r.length !== k) ||
        transitions.some((r) => r.length !== k) ||
        [...emissions.flat(), ...transitions.flat(), ...startScores, ...endScores].some(
            (s) => !Number.isFinite(s),
        )
    )
        throw new Error("Invalid CRF dimensions or scores.");
    let scores = startScores.map((s, i) => s + emissions[0]![i]!);
    const back: number[][] = [];
    for (let t = 1; t < emissions.length; t++) {
        const row: number[] = [];
        const next = Array.from({ length: k }, (_, j) => {
            let best = -Infinity,
                previous = 0;
            for (let i = 0; i < k; i++) {
                const value = scores[i]! + transitions[i]![j]!;
                if (value > best) {
                    best = value;
                    previous = i;
                }
            }
            row[j] = previous;
            return best + emissions[t]![j]!;
        });
        back.push(row);
        scores = next;
    }
    const final = scores.map((s, i) => s + endScores[i]!);
    let tag = final.indexOf(Math.max(...final));
    const path = [tag];
    for (let t = back.length - 1; t >= 0; t--) {
        tag = back[t]![tag]!;
        path.push(tag);
    }
    return path.reverse();
}

export class PlattCalibration {
    constructor(
        private readonly a: number,
        private readonly b: number,
        readonly provenance: string,
    ) {
        if (!Number.isFinite(a) || !Number.isFinite(b) || !provenance)
            throw new Error("Calibration needs finite parameters and held-out provenance.");
    }
    probability(rawScore: number): number {
        if (!Number.isFinite(rawScore)) throw new Error("Invalid raw score.");
        const x = this.a * rawScore + this.b;
        return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
    }
}
