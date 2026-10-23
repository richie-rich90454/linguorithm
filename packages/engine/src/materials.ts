import { EssayDocument, type Exercise, type Material, type SkillId } from "./domain";
import { createPipeline } from "./pipeline";
import { validateExercise } from "./learning";
import { MaterialExtractor } from "./material-analysis";
import { exerciseBank } from "./exercises";
import { mutationOperators, validatedMutation } from "./mutations";

const normalized = (value: string): string => value.toLowerCase().replace(/\s+/gu, " ").trim();
const definitionKey = (value: string): string =>
    (normalized(value).match(/\p{L}+/gu) ?? [])
        .filter((word) => !/^(?:a|an|the|that|which|is|are)$/u.test(word))
        .sort()
        .join(" ");

function unambiguousDefinitions(pairs: ReturnType<MaterialExtractor["analyze"]>["definitions"]) {
    const byTerm = new Map<string, Set<string>>(),
        byDefinition = new Map<string, Set<string>>();
    for (const pair of pairs) {
        const term = normalized(pair.term),
            definition = definitionKey(pair.definition);
        if (!byTerm.has(term)) byTerm.set(term, new Set());
        if (!byDefinition.has(definition)) byDefinition.set(definition, new Set());
        byTerm.get(term)!.add(definition);
        byDefinition.get(definition)!.add(term);
    }
    const seen = new Set<string>();
    return pairs.filter((pair) => {
        const term = normalized(pair.term);
        if (
            seen.has(term) ||
            byTerm.get(term)!.size !== 1 ||
            byDefinition.get(definitionKey(pair.definition))!.size !== 1 ||
            /\b(?:not|never|incorrect|wrong|except|sometimes|usually)\b/iu.test(pair.definition) ||
            pair.term.split(/\s+/u).length > 6
        )
            return false;
        seen.add(term);
        return true;
    });
}

const definitions = [
    {
        term: "noun",
        definition: "a word that names a person, place, thing, or idea",
        skill: "sentence",
    },
    { term: "verb", definition: "a word that expresses an action or state", skill: "verb-forms" },
    { term: "adjective", definition: "a word that modifies a noun or pronoun", skill: "sentence" },
    {
        term: "adverb",
        definition: "a word that modifies a verb, adjective, or another adverb",
        skill: "sentence",
    },
    { term: "pronoun", definition: "a word that takes the place of a noun", skill: "pronouns" },
    {
        term: "independent clause",
        definition: "a clause that can stand alone as a sentence",
        skill: "boundaries",
    },
    {
        term: "dependent clause",
        definition: "a clause that cannot stand alone as a sentence",
        skill: "boundaries",
    },
] as const;

export class QuizAssembler {
    fromMaterial(source: Material): { exercises: Exercise[]; limitations: string[] } {
        const exercises: Exercise[] = [];
        const extraction = new MaterialExtractor().analyze(source);
        // Conflicting terms and definitions shared by two terms cannot support one answer.
        const safeDefinitions = unambiguousDefinitions(extraction.definitions);
        // Only explicit source definitions matching approved concepts become definition items.
        for (const entry of definitions) {
            const pair = safeDefinitions.find((p) => normalized(p.term) === entry.term);
            if (!pair) continue;
            const content = pair.definition;
            const anchors: Record<string, RegExp> = {
                noun: /^(?:a )?word that names?\b.*\b(?:person|place|thing|idea)\b/iu,
                verb: /^(?:a )?word that expresses (?:an? )?(?:action|state)\b/iu,
                adjective: /^(?:a )?word that modifies (?:a )?noun\b/iu,
                adverb: /^(?:a )?word that modifies (?:a )?(?:verb|adjective)\b/iu,
                pronoun: /^(?:a )?word that (?:takes the place of|replaces) (?:a )?noun\b/iu,
                "independent clause": /^(?:a )?clause that can stand alone\b/iu,
                "dependent clause": /^(?:a )?clause that (?:cannot|can't|can not) stand alone\b/iu,
            };
            if (!anchors[entry.term]!.test(content)) continue;
            const options = [
                entry.term,
                ...definitions
                    .filter((x) => x.term !== entry.term)
                    .slice(0, 3)
                    .map((x) => x.term),
            ];
            const answer = (pair.start + entry.term.length) % options.length;
            const correct = options.shift()!;
            options.splice(answer, 0, correct);
            exercises.push({
                id: `material:${source.id}:definition:${entry.term}`,
                skill: entry.skill as SkillId,
                prompt: "Which term matches this definition in your material?",
                sentence: content,
                options,
                answer,
                explanation: `Your material explicitly defines “${entry.term}” as “${content}”.`,
                hints: [
                    "Use the definition in the quoted source.",
                    `The term begins with “${entry.term[0]}”.`,
                ],
                feedback: options.map((option) =>
                    option === entry.term
                        ? "This is the term explicitly defined in the source."
                        : `The source assigns this definition to “${entry.term}”, rather than “${option}”.`,
                ),
                difficulty: 1,
                source: {
                    name: source.name,
                    quote: pair.quote,
                    location: `Characters ${pair.start + 1}–${pair.end}`,
                },
                validation: "source-matched",
            });
        }
        const unambiguous = safeDefinitions.filter(
            (pair) =>
                !definitions.some((known) => known.term.toLowerCase() === pair.term.toLowerCase()),
        );
        if (new Set(unambiguous.map((p) => p.term.toLowerCase())).size >= 3)
            for (const [i, pair] of unambiguous.slice(0, 20).entries()) {
                const alternatives = [
                    ...new Set(unambiguous.map((p) => p.term).filter((t) => t !== pair.term)),
                ].slice(0, 3);
                const options = [...alternatives];
                const answer = i % (alternatives.length + 1);
                options.splice(answer, 0, pair.term);
                exercises.push({
                    id: `material:${source.id}:explicit:${pair.start}`,
                    skill: "usage",
                    prompt: "According to your material, which term has this definition?",
                    sentence: pair.definition,
                    options,
                    answer,
                    explanation: `The source explicitly states: “${pair.quote}”.`,
                    feedback: options.map((option) =>
                        option === pair.term
                            ? "This matches the explicit source definition."
                            : `The source assigns this definition to “${pair.term}”.`,
                    ),
                    hints: [
                        "Compare the exact definitions in your source.",
                        `The term begins with “${pair.term[0]}”.`,
                    ],
                    difficulty: 1,
                    source: {
                        name: source.name,
                        quote: pair.quote,
                        location: `Characters ${pair.start + 1}–${pair.end}`,
                    },
                    validation: "source-matched",
                });
            }
        for (const concept of extraction.concepts.slice(0, 10)) {
            if (exercises.some((q) => q.skill === concept.skill)) continue;
            const approved = exerciseBank.find((q) => q.skill === concept.skill);
            if (approved)
                exercises.push({
                    ...approved,
                    id: `material:${source.id}:concept:${concept.skill}`,
                    prompt: approved.prompt + " (Practice a concept mentioned in your material.)",
                    explanation:
                        approved.explanation +
                        " This is an authored curriculum example for a concept identified in your material, rather than a quotation of an example from it.",
                    source: {
                        name: source.name,
                        quote: concept.quote,
                        location: `Characters ${concept.start + 1}–${concept.end}; example from ${approved.id}`,
                    },
                    validation: "source-matched",
                });
        }
        const pipeline = createPipeline();
        const report = pipeline.analyze(source.text);
        for (const sentence of report.sentences.slice(0, 100)) {
            if (
                sentence.text.length > 300 ||
                sentence.tokens.length < 4 ||
                sentence.tokens.length > 50 ||
                !/[.!]$/u.test(sentence.text) ||
                /["“”]|___/u.test(sentence.text) ||
                extraction.definitions.some(
                    (pair) => pair.start < sentence.end && pair.end > sentence.start,
                ) ||
                report.diagnostics.some((d) => d.start >= sentence.start && d.end <= sentence.end)
            )
                continue;
            for (const operator of mutationOperators) {
                const item = validatedMutation(sentence.text, operator, "source-cloze-check");
                if (!item) continue;
                const originalTokens = pipeline.analyze(sentence.text).sentences[0]!.tokens;
                const changedTokens = pipeline.analyze(item.sentence).sentences[0]!.tokens;
                if (originalTokens.length !== changedTokens.length) continue;
                const changed = originalTokens.flatMap((token, i) =>
                    token.text !== changedTokens[i]!.text ? [i] : [],
                );
                if (changed.length !== 1) continue;
                const token = originalTokens[changed[0]!]!,
                    alternative = changedTokens[changed[0]!]!.text;
                if (!/^\p{L}+$/u.test(token.text) || !/^\p{L}+$/u.test(alternative)) continue;
                const answer = sentence.start % 2;
                const options = answer ? [alternative, token.text] : [token.text, alternative];
                exercises.push({
                    id: `material:${source.id}:cloze:${sentence.start}:${operator.id}`,
                    skill: operator.skill,
                    prompt: "Complete the source sentence while preserving its grammar and wording.",
                    sentence:
                        sentence.text.slice(0, token.start) +
                        "___" +
                        sentence.text.slice(token.end),
                    options,
                    answer,
                    explanation: `The source uses “${token.text}”. ${operator.explanation}`,
                    feedback: options.map((_, i) =>
                        i === answer
                            ? `“${token.text}” preserves the source wording. ${operator.explanation}`
                            : operator.explanation,
                    ),
                    hints: item.hints,
                    difficulty: item.difficulty,
                    source: {
                        name: source.name,
                        quote: sentence.text,
                        location: `Characters ${sentence.start + 1}–${sentence.end}; operator ${operator.id}@1.0.0`,
                    },
                    validation: "source-matched",
                });
                break;
            }
            if (exercises.filter((q) => q.id.includes(":cloze:")).length >= 20) break;
        }
        for (const d of report.diagnostics
            .filter((d) =>
                ["agreement", "verb-form", "article-sound", "spelling"].includes(d.ruleId),
            )
            .slice(0, 20)) {
            const sentence = report.sentences.find((s) => s.start <= d.start && s.end >= d.end);
            const proposal = d.proposals[0];
            if (
                !sentence ||
                !proposal ||
                !proposal.edits[0] ||
                report.diagnostics.filter(
                    (issue) => issue.start >= sentence.start && issue.end <= sentence.end,
                ).length !== 1
            )
                continue;
            const edit = proposal.edits[0];
            if (
                proposal.edits.some(
                    (change) => change.start < sentence.start || change.end > sentence.end,
                )
            )
                continue;
            const corrected = EssayDocument.create(sentence.text).apply({
                ...proposal,
                edits: proposal.edits.map((change) => ({
                    ...change,
                    start: change.start - sentence.start,
                    end: change.end - sentence.start,
                })),
            }).text;
            if (pipeline.analyze(corrected).diagnostics.length) continue;
            const options = [sentence.text, corrected];
            exercises.push({
                id: `material:${source.id}:repair:${d.id}`,
                skill: d.skill,
                type: "repair",
                acceptedAnswers: [corrected],
                prompt: `Which version resolves the flagged ${d.category.toLowerCase()} issue?`,
                sentence: sentence.text,
                options,
                answer: 1,
                explanation: d.explanation,
                hints: [d.title, `Focus on “${edit.expected}”.`],
                feedback: ["This retains the flagged issue. " + d.explanation, d.explanation],
                difficulty: 2,
                source: {
                    name: source.name,
                    quote: sentence.text,
                    location: `Characters ${sentence.start + 1}–${sentence.end}`,
                },
                validation: "verified-mutation",
            });
        }
        return {
            exercises: exercises.filter((q) => validateExercise(q).length === 0),
            limitations: [
                exercises.length
                    ? "Questions use explicit definitions, constraint-checked source cloze items, rechecked corrections, or authored practice for concepts mentioned in your source. Deterministic checks cover only supported constructions; educator review remains useful."
                    : "No supported definitions or reliable repair questions were found. Try material with explicit grammar definitions or examples.",
                "Images, scanned pages, and arbitrary factual trivia are not converted into questions.",
            ],
        };
    }
}
