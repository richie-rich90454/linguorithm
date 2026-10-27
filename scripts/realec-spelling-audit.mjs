const BIN_ORDER = {
    editDistance: ["0", "1", "2", "3+", "unavailable"],
    candidateFrequency: ["0-2", "3-9", "10-49", "50-199", "200+", "unavailable"],
    contextualGain: ["<-2.3", "[-2.3,0)", "[0,2.3)", ">=2.3", "unavailable"],
};

function sourceTokens(text) {
    return [...text.matchAll(/[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|[^\s]/gu)].map(
        (match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }),
    );
}

function coveredTokens(tokens, start, end) {
    if (start === end) {
        const next = tokens.findIndex((token) => token.start >= start),
            index = next >= 0 ? next : tokens.length - 1;
        return index >= 0 ? [index] : [];
    }
    const covered = tokens.flatMap((token, index) =>
        token.start < end && token.end > start ? [index] : [],
    );
    if (covered.length || !tokens.length) return covered;
    const next = tokens.findIndex((token) => token.start >= start),
        index = next >= 0 ? next : tokens.length - 1;
    return index >= 0 ? [index] : [];
}

function damerauDistance(left, right) {
    const a = [...left.toLowerCase()],
        b = [...right.toLowerCase()],
        max = a.length + b.length,
        rows = Array.from({ length: a.length + 2 }, () => new Float64Array(b.length + 2));
    rows[0][0] = max;
    for (let i = 0; i <= a.length; i++) {
        rows[i + 1][0] = max;
        rows[i + 1][1] = i;
    }
    for (let j = 0; j <= b.length; j++) {
        rows[0][j + 1] = max;
        rows[1][j + 1] = j;
    }
    const last = new Map();
    for (let i = 1; i <= a.length; i++) {
        let matched = 0;
        for (let j = 1; j <= b.length; j++) {
            const previousRow = last.get(b[j - 1]) ?? 0,
                previousColumn = matched,
                cost = a[i - 1] === b[j - 1] ? 0 : 1;
            if (!cost) matched = j;
            rows[i + 1][j + 1] = Math.min(
                rows[i][j] + cost,
                rows[i + 1][j] + 1,
                rows[i][j + 1] + 1,
                rows[previousRow][previousColumn] +
                    i -
                    previousRow -
                    1 +
                    1 +
                    j -
                    previousColumn -
                    1,
            );
        }
        last.set(a[i - 1], i);
    }
    return rows[a.length + 1][b.length + 1];
}

function categorical(value, boundaries) {
    if (!Number.isFinite(value)) return "unavailable";
    if (boundaries === BIN_ORDER.editDistance) return value >= 3 ? "3+" : String(value);
    if (boundaries === BIN_ORDER.candidateFrequency) {
        if (value < 3) return "0-2";
        if (value < 10) return "3-9";
        if (value < 50) return "10-49";
        if (value < 200) return "50-199";
        return "200+";
    }
    if (value < -2.3) return "<-2.3";
    if (value < 0) return "[-2.3,0)";
    if (value < 2.3) return "[0,2.3)";
    return ">=2.3";
}

function contextualLogScore(previous, candidate, next, contextual) {
    if (!contextual?.unigrams || !contextual?.bigrams) return undefined;
    const vocabularySize = Object.keys(contextual.unigrams).length + 1,
        smoothing = Number.isFinite(contextual.smoothing) ? contextual.smoothing : 0.1,
        logProbability = (left, right) => {
            const count = contextual.bigrams[`${left}\0${right}`] ?? 0,
                total = contextual.unigrams[left] ?? 0;
            if (contextual.continuation && contextual.followers && contextual.totalTypes) {
                const continuation = (contextual.continuation[right] ?? 1) / contextual.totalTypes,
                    discount = contextual.discount ?? 0.75;
                return Math.log(
                    Math.max(
                        1e-12,
                        total
                            ? Math.max(0, count - discount) / total +
                                  ((discount * (contextual.followers[left] ?? 0)) / total) *
                                      continuation
                            : continuation,
                    ),
                );
            }
            return Math.log((count + smoothing) / (total + smoothing * vocabularySize));
        };
    return logProbability(previous, candidate) + logProbability(candidate, next);
}

function candidateFeatures(tokens, diagnostic, frequency, contextual) {
    const proposal = diagnostic.proposals?.[0],
        edit = proposal?.edits?.[0];
    if (!edit || typeof edit.replacement !== "string" || !edit.replacement.trim())
        return {
            editDistance: "unavailable",
            candidateFrequency: "unavailable",
            contextualGain: "unavailable",
        };
    const original = edit.expected.toLowerCase(),
        replacement = edit.replacement.toLowerCase(),
        distance = damerauDistance(original, replacement),
        candidateFrequency = frequency[replacement] ?? 0,
        covered = coveredTokens(tokens, diagnostic.start, diagnostic.end),
        tokenIndex = covered[0],
        previous =
            tokenIndex === undefined
                ? "<s>"
                : (tokens[tokenIndex - 1]?.text.toLowerCase() ?? "<s>"),
        next =
            tokenIndex === undefined
                ? "</s>"
                : (tokens[tokenIndex + 1]?.text.toLowerCase() ?? "</s>"),
        originalContext = contextualLogScore(previous, original, next, contextual),
        replacementContext = contextualLogScore(previous, replacement, next, contextual),
        gain =
            originalContext === undefined || replacementContext === undefined
                ? undefined
                : replacementContext - originalContext;
    return {
        editDistance: categorical(distance, BIN_ORDER.editDistance),
        candidateFrequency: categorical(candidateFrequency, BIN_ORDER.candidateFrequency),
        contextualGain: categorical(gain, BIN_ORDER.contextualGain),
    };
}

/**
 * Summarize development-only dictionary-spelling predictions without retaining text or IDs.
 * Gold overlap is token-level and uses the same source-token projection as the main evaluator.
 */
export function buildRealecSpellingCalibration(split, documents, reports, frequency, contextual) {
    if (split !== "development") return undefined;
    const counts = new Map();
    for (const [documentIndex, document] of documents.entries()) {
        const report = reports[documentIndex];
        if (!report || report.text !== document.text) continue;
        const tokens = sourceTokens(document.text),
            gold = tokens.map(() => false),
            assigned = new Set();
        for (const annotation of document.annotations ?? [])
            for (const [start, end] of annotation.spans ?? [])
                for (const index of coveredTokens(tokens, start, end)) gold[index] = true;
        const diagnostics = (report.diagnostics ?? [])
            .filter((diagnostic) => diagnostic.ruleId === "dictionary-spelling")
            .sort(
                (a, b) =>
                    a.start - b.start ||
                    a.end - b.end ||
                    (a.proposals?.[0]?.edits?.[0]?.replacement ?? "").localeCompare(
                        b.proposals?.[0]?.edits?.[0]?.replacement ?? "",
                    ),
            );
        for (const diagnostic of diagnostics) {
            const features = candidateFeatures(tokens, diagnostic, frequency, contextual),
                key = [
                    features.editDistance,
                    features.candidateFrequency,
                    features.contextualGain,
                ].join("|");
            for (const index of coveredTokens(tokens, diagnostic.start, diagnostic.end)) {
                if (assigned.has(index)) continue;
                assigned.add(index);
                const bin = counts.get(key) ?? {
                    editDistance: features.editDistance,
                    candidateFrequency: features.candidateFrequency,
                    contextualGain: features.contextualGain,
                    predictions: 0,
                    annotationOverlaps: 0,
                };
                bin.predictions++;
                if (gold[index]) bin.annotationOverlaps++;
                counts.set(key, bin);
            }
        }
    }
    const order = (axis, value) => BIN_ORDER[axis].indexOf(value);
    return {
        scope: "Development-only candidate calibration; not a validated quality estimate.",
        dimensions: {
            editDistance:
                "Damerau-Levenshtein distance from the observed token to the first accepted correction.",
            candidateFrequency:
                "Frequency of that correction in the packaged local EWT training lexicon.",
            contextualGain:
                "Candidate minus observed-token two-sided log bigram score from the packaged EWT model; bins ±2.3 represent about a tenfold likelihood ratio.",
        },
        bins: [...counts.values()].sort(
            (a, b) =>
                order("editDistance", a.editDistance) - order("editDistance", b.editDistance) ||
                order("candidateFrequency", a.candidateFrequency) -
                    order("candidateFrequency", b.candidateFrequency) ||
                order("contextualGain", a.contextualGain) -
                    order("contextualGain", b.contextualGain),
        ),
    };
}
