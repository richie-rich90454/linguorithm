// A curated seed lexicon. Unknown words are deliberately not treated as errors.
const vocabulary =
    "the their there they're receive believe separate necessary definitely environment government grammar writing sentence paragraph student students because although beginning occurred accommodate achieve argument beautiful business calendar category colleague committee conscious decision describe development difference different education effect example exercise experience explanation familiar February foreign forty friend further independent knowledge language library maintenance meaning opportunity parallel particular people performance practice privilege probably pronunciation public punctuation question really recommend reference relevant rhythm science similar sincerely strength successful surprise temperature tomorrow truly understanding until usually whether which without woman women written".split(
        " ",
    );
const spacingBoundaries = new Set(
    "a an the this that these those my your his her its our their i me we us you he him she it they them who whom whose which what when where why how all some any each every no not do does did is am are was were be been being have has had can could will would should may might must shall and or but so yet nor in on at by for from of to with into onto upon over under after before during until since as if while because than".split(
        " ",
    ),
);
function deletions(word: string, depth = 1): Set<string> {
    const keys = new Set([word]);
    let frontier = [word];
    for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const value of frontier) {
            const characters = [...value];
            for (let i = 0; i < characters.length; i++) {
                const key = characters.slice(0, i).join("") + characters.slice(i + 1).join("");
                if (!keys.has(key)) {
                    keys.add(key);
                    next.push(key);
                }
            }
        }
        frontier = next;
    }
    return keys;
}
export function editDistance(a: string, b: string): number {
    const left = [...a],
        right = [...b],
        maximum = left.length + right.length;
    const rows = Array.from({ length: left.length + 2 }, () => new Float64Array(right.length + 2));
    rows[0]![0] = maximum;
    for (let i = 0; i <= left.length; i++) {
        rows[i + 1]![0] = maximum;
        rows[i + 1]![1] = i;
    }
    for (let j = 0; j <= right.length; j++) {
        rows[0]![j + 1] = maximum;
        rows[1]![j + 1] = j;
    }
    const last = new Map<string, number>();
    for (let i = 1; i <= left.length; i++) {
        let matched = 0;
        for (let j = 1; j <= right.length; j++) {
            const previousRow = last.get(right[j - 1]!) ?? 0,
                previousColumn = matched;
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
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
        last.set(left[i - 1]!, i);
    }
    return rows[left.length + 1]![right.length + 1]!;
}

interface TrieNode {
    character: string;
    child: number;
    sibling: number;
    word?: string;
}

// Linked child indices avoid one Map allocation for every dictionary prefix.
class DictionaryTrie {
    private readonly nodes: TrieNode[] = [{ character: "", child: -1, sibling: -1 }];
    constructor(words: readonly string[]) {
        for (const word of words) {
            if ([...word].length > 32) continue;
            let parent = 0;
            for (const character of word) {
                let child = this.nodes[parent]!.child;
                while (child !== -1 && this.nodes[child]!.character !== character)
                    child = this.nodes[child]!.sibling;
                if (child === -1) {
                    child = this.nodes.length;
                    this.nodes.push({
                        character,
                        child: -1,
                        sibling: this.nodes[parent]!.child,
                    });
                    this.nodes[parent]!.child = child;
                }
                parent = child;
            }
            this.nodes[parent]!.word = word;
        }
    }

    candidates(word: string, distance: number): Set<string> {
        const target = [...word],
            maximum = 32 + target.length,
            rows = [
                new Float64Array(target.length + 2).fill(maximum),
                Float64Array.from({ length: target.length + 2 }, (_, j) =>
                    j === 0 ? maximum : j - 1,
                ),
            ],
            last = new Map<string, number>(),
            found = new Set<string>();
        let remaining = 20_000;
        const visit = (index: number, depth: number): void => {
            if (remaining-- <= 0 || found.size >= 200) return;
            const node = this.nodes[index]!,
                row = new Float64Array(target.length + 2);
            row[0] = maximum;
            row[1] = depth;
            let matched = 0,
                minimum = depth;
            for (let j = 1; j <= target.length; j++) {
                const previousRow = last.get(target[j - 1]!) ?? 0,
                    previousColumn = matched,
                    cost = node.character === target[j - 1] ? 0 : 1;
                if (!cost) matched = j;
                row[j + 1] = Math.min(
                    rows[depth]![j]! + cost,
                    row[j]! + 1,
                    rows[depth]![j + 1]! + 1,
                    rows[previousRow]![previousColumn]! +
                        depth -
                        previousRow +
                        j -
                        previousColumn -
                        1,
                );
                minimum = Math.min(minimum, row[j + 1]!);
            }
            if (node.word && row[target.length + 1]! <= distance) found.add(node.word);
            if (minimum > distance || depth >= target.length + distance) return;
            rows.push(row);
            const previous = last.get(node.character);
            last.set(node.character, depth);
            // Explore the matching prefix first so the budget favors nearby spellings.
            let matching = node.child;
            while (matching !== -1 && this.nodes[matching]!.character !== target[depth])
                matching = this.nodes[matching]!.sibling;
            if (matching !== -1) visit(matching, depth + 1);
            for (
                let child = node.child;
                child !== -1 && remaining > 0;
                child = this.nodes[child]!.sibling
            )
                if (child !== matching) visit(child, depth + 1);
            if (previous === undefined) last.delete(node.character);
            else last.set(node.character, previous);
            rows.pop();
        };
        let matching = this.nodes[0]!.child;
        while (matching !== -1 && this.nodes[matching]!.character !== target[0])
            matching = this.nodes[matching]!.sibling;
        if (matching !== -1) visit(matching, 1);
        for (
            let child = this.nodes[0]!.child;
            child !== -1 && remaining > 0;
            child = this.nodes[child]!.sibling
        )
            if (child !== matching) visit(child, 1);
        return found;
    }
}
// The packaged dictionary is US English, but valid British spellings appear in
// learner writing. Accept the common mechanical variants rather than flagging
// them as misspellings; irregular pairs are listed explicitly.
const britishVariants: Record<string, string> = {
    acknowledgement: "acknowledgment",
    ageing: "aging",
    aluminium: "aluminum",
    amidst: "amid",
    amongst: "among",
    anaemia: "anemia",
    anaesthetic: "anesthetic",
    archaeology: "archeology",
    axe: "ax",
    burnt: "burned",
    cheque: "check",
    cosy: "cozy",
    diarrhoea: "diarrhea",
    distil: "distill",
    draught: "draft",
    dreamt: "dreamed",
    enquiry: "inquiry",
    enrol: "enroll",
    foetus: "fetus",
    fulfil: "fulfill",
    gaol: "jail",
    grey: "gray",
    gynaecology: "gynecology",
    haemoglobin: "hemoglobin",
    instil: "instill",
    jewellery: "jewelry",
    judgement: "judgment",
    kerb: "curb",
    learnt: "learned",
    leukaemia: "leukemia",
    manoeuvre: "maneuver",
    maths: "math",
    mediaeval: "medieval",
    mould: "mold",
    moustache: "mustache",
    oestrogen: "estrogen",
    orthopaedic: "orthopedic",
    paediatric: "pediatric",
    plough: "plow",
    practise: "practice",
    practised: "practiced",
    practises: "practices",
    practising: "practicing",
    pyjamas: "pajamas",
    sceptic: "skeptic",
    sceptical: "skeptical",
    skilful: "skillful",
    smoulder: "smolder",
    spelt: "spelled",
    spoilt: "spoiled",
    storey: "story",
    sulphate: "sulfate",
    sulphur: "sulfur",
    tyre: "tire",
    whilst: "while",
    wilful: "willful",
};

function americanForms(word: string): Set<string> {
    const forms = new Set<string>();
    const add = (candidate: string) => {
        if (candidate.length >= 3 && candidate !== word) forms.add(candidate);
    };
    const irregular = britishVariants[word];
    if (irregular) add(irregular);
    for (const [suffix, replacement] of [
        ["isations", "izations"],
        ["isation", "ization"],
        ["isational", "izational"],
        ["isers", "izers"],
        ["iser", "izer"],
        ["ised", "ized"],
        ["ising", "izing"],
        ["ises", "izes"],
        ["ise", "ize"],
        ["ysed", "yzed"],
        ["ysing", "yzing"],
        ["yses", "yzes"],
        ["yse", "yze"],
        ["oured", "ored"],
        ["ouring", "oring"],
        ["ourite", "orite"],
        ["ourful", "orful"],
        ["ourless", "orless"],
        ["ourable", "orable"],
        ["ourably", "orably"],
        ["ours", "ors"],
        ["our", "or"],
        ["llers", "lers"],
        ["ller", "ler"],
        ["llors", "lors"],
        ["llor", "lor"],
        ["lled", "led"],
        ["lling", "ling"],
        ["lments", "llments"],
        ["lment", "llment"],
        ["res", "ers"],
        ["red", "ered"],
        ["ring", "ering"],
        ["re", "er"],
        ["ces", "ses"],
        ["ce", "se"],
        ["ogues", "ogs"],
        ["ogue", "og"],
        ["grammes", "grams"],
        ["gramme", "gram"],
        ["mme", "m"],
        ["ae", "e"],
        ["oe", "e"],
    ] as const) {
        if (word.endsWith(suffix)) add(word.slice(0, -suffix.length) + replacement);
    }
    return forms;
}

export class SpellingIndex {
    private readonly index = new Map<string, Set<string>>();
    private readonly known: Set<string>;
    private readonly dictionary?: DictionaryTrie;
    private readonly distance: number;
    private readonly acceptedVariants = new Map<string, boolean>();
    constructor(
        words: readonly string[] = vocabulary,
        private readonly frequency: Readonly<Record<string, number>> = {},
        distance = 1,
    ) {
        this.distance = Number.isFinite(distance)
            ? Math.max(0, Math.min(2, Math.floor(distance)))
            : 1;
        this.known = new Set(words);
        const hasFrequency = Object.keys(frequency).length > 0;
        if (hasFrequency) this.dictionary = new DictionaryTrie(words);
        for (const word of words.filter(
            (w) => w.length <= 32 && (!hasFrequency || (frequency[w] ?? 0) >= 3),
        ))
            for (const key of deletions(word, this.distance)) {
                const set = this.index.get(key) ?? new Set<string>();
                set.add(word);
                this.index.set(key, set);
            }
    }
    has(word: string): boolean {
        const lower = word.toLowerCase();
        if (this.known.has(lower)) return true;
        const cached = this.acceptedVariants.get(lower);
        if (cached !== undefined) return cached;
        const accepted = [...americanForms(lower)].some((form) => this.known.has(form));
        this.acceptedVariants.set(lower, accepted);
        return accepted;
    }
    splitConcatenated(input: string): string | undefined {
        const word = input.toLowerCase();
        if (!/^[a-z]{4,32}$/u.test(word) || this.known.has(word)) return undefined;
        const candidates: string[] = [];
        for (let boundary = 1; boundary <= word.length - 2; boundary++) {
            const left = word.slice(0, boundary),
                right = word.slice(boundary),
                leftFrequency = this.frequency[left] ?? 0,
                rightFrequency = this.frequency[right] ?? 0,
                leftSupported = this.known.has(left) || leftFrequency >= 3,
                rightSupported = this.known.has(right) || rightFrequency >= 3,
                commonBoundary =
                    (spacingBoundaries.has(left) && leftFrequency >= 25) ||
                    (spacingBoundaries.has(right) && rightFrequency >= 25),
                componentsHaveWordShape =
                    (left.length >= 3 || spacingBoundaries.has(left)) &&
                    (right.length >= 3 || spacingBoundaries.has(right));
            if (leftSupported && rightSupported && commonBoundary && componentsHaveWordShape)
                candidates.push(`${left} ${right}`);
        }
        return candidates.length === 1 ? candidates[0] : undefined;
    }
    candidates(input: string): string[] {
        const word = input.toLowerCase();
        if (word.length < 4 || word.length > 40 || this.known.has(word)) return [];
        let candidates = new Set<string>();
        for (const key of deletions(word, this.distance))
            for (const candidate of this.index.get(key) ?? [])
                if (candidates.size < 200 && editDistance(word, candidate) <= this.distance)
                    candidates.add(candidate);
        if (!candidates.size && this.dictionary)
            candidates = this.dictionary.candidates(word, this.distance);
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
