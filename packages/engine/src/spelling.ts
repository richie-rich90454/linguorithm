// A curated seed lexicon. Unknown words are deliberately not treated as errors.
const vocabulary =
    "the their there they're receive believe separate necessary definitely environment government grammar writing sentence paragraph student students because although beginning occurred accommodate achieve argument beautiful business calendar category colleague committee conscious decision describe development difference different education effect example exercise experience explanation familiar February foreign forty friend further independent knowledge language library maintenance meaning opportunity parallel particular people performance practice privilege probably pronunciation public punctuation question really recommend reference relevant rhythm science similar sincerely strength successful surprise temperature tomorrow truly understanding until usually whether which without woman women written".split(
        " ",
    );
function deletions(word: string, depth = 1): Set<string> {
    const keys = new Set([word]);
    let frontier = [word];
    for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const value of frontier)
            for (let i = 0; i < value.length; i++) {
                const key = value.slice(0, i) + value.slice(i + 1);
                if (!keys.has(key)) {
                    keys.add(key);
                    next.push(key);
                }
            }
        frontier = next;
    }
    return keys;
}
export function editDistance(a: string, b: string): number {
    const maximum = a.length + b.length;
    const rows = Array.from({ length: a.length + 2 }, () => new Float64Array(b.length + 2));
    rows[0]![0] = maximum;
    for (let i = 0; i <= a.length; i++) {
        rows[i + 1]![0] = maximum;
        rows[i + 1]![1] = i;
    }
    for (let j = 0; j <= b.length; j++) {
        rows[0]![j + 1] = maximum;
        rows[1]![j + 1] = j;
    }
    const last = new Map<string, number>();
    for (let i = 1; i <= a.length; i++) {
        let matched = 0;
        for (let j = 1; j <= b.length; j++) {
            const previousRow = last.get(b[j - 1]!) ?? 0,
                previousColumn = matched;
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            if (!cost) matched = j;
            rows[i + 1]![j + 1] = Math.min(
                rows[i]![j]! + cost,
                rows[i + 1]![j]! + 1,
                rows[i]![j + 1]! + 1,
                rows[previousRow]![previousColumn]! +
                    i -
                    previousRow -
                    1 +
                    1 +
                    j -
                    previousColumn -
                    1,
            );
        }
        last.set(a[i - 1]!, i);
    }
    return rows[a.length + 1]![b.length + 1]!;
}
export class SpellingIndex {
    private readonly index = new Map<string, Set<string>>();
    private readonly known: Set<string>;
    constructor(
        words: readonly string[] = vocabulary,
        private readonly frequency: Readonly<Record<string, number>> = {},
        private readonly distance = 1,
    ) {
        this.known = new Set(words);
        const hasFrequency = Object.keys(frequency).length > 0;
        for (const word of words.filter(
            (w) => w.length <= 32 && (!hasFrequency || (frequency[w] ?? 0) >= 3),
        ))
            for (const key of deletions(word, distance)) {
                const set = this.index.get(key) ?? new Set<string>();
                set.add(word);
                this.index.set(key, set);
            }
    }
    has(word: string): boolean {
        return this.known.has(word.toLowerCase());
    }
    candidates(input: string): string[] {
        const word = input.toLowerCase();
        if (word.length < 4 || word.length > 40 || this.known.has(word)) return [];
        const candidates = new Set<string>();
        for (const key of deletions(word, this.distance))
            for (const candidate of this.index.get(key) ?? [])
                if (candidates.size < 200 && editDistance(word, candidate) <= this.distance)
                    candidates.add(candidate);
        return [...candidates]
            .sort(
                (a, b) =>
                    editDistance(word, a) - editDistance(word, b) ||
                    (this.frequency[b] ?? 0) - (this.frequency[a] ?? 0) ||
                    a.localeCompare(b),
            )
            .slice(0, 3);
    }
}
