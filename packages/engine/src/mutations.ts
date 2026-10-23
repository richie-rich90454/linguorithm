import type { Exercise, SkillId } from "./domain";
import { createPipeline } from "./pipeline";
import { EssayDocument } from "./domain";
import { validateExercise } from "./learning";

export interface MutationOperator {
    id: string;
    skill: SkillId;
    ruleId: string;
    explanation: string;
    mutate(source: string): string | undefined;
}
const pipeline = createPipeline();
export const mutationOperators: readonly MutationOperator[] = [
    {
        id: "finite-number",
        skill: "agreement",
        ruleId: "agreement",
        explanation: "The finite verb must agree with the head of its subject phrase.",
        mutate(source) {
            const sentence = pipeline.analyze(source).sentences[0];
            if (!sentence) return;
            const subject = sentence.graph.find((e) => e.relation === "nsubj");
            if (!subject) return;
            const token = sentence.tokens[subject.head]!,
                replacement = (
                    { is: "are", are: "is", has: "have", have: "has" } as Record<string, string>
                )[token.text.toLowerCase()];
            return replacement
                ? source.slice(0, token.start) + replacement + source.slice(token.end)
                : undefined;
        },
    },
    {
        id: "modal-base",
        skill: "verb-forms",
        ruleId: "verb-form",
        explanation: "A modal auxiliary takes a base-form verb, rather than a finite inflection.",
        mutate(source) {
            const alternatives: Record<string, string> = {
                go: "goes",
                work: "works",
                study: "studies",
                write: "writes",
                like: "likes",
                have: "has",
                be: "is",
                do: "does",
            };
            return source.replace(
                /\b(can|could|will|would|should|must|may|might)(\s+)(go|work|study|write|like|have|be|do)\b/iu,
                (_, modal: string, space: string, verb: string) =>
                    modal + space + alternatives[verb.toLowerCase()],
            );
        },
    },
    {
        id: "perfect-participle",
        skill: "verb-forms",
        ruleId: "verb-form",
        explanation:
            "A perfect auxiliary takes the past participle, rather than the simple-past form.",
        mutate(source) {
            const alternatives: Record<string, string> = {
                gone: "went",
                written: "wrote",
                eaten: "ate",
                seen: "saw",
                done: "did",
                taken: "took",
                given: "gave",
            };
            return source.replace(
                /\b(has|have|had)(\s+)(gone|written|eaten|seen|done|taken|given)\b/iu,
                (_, auxiliary: string, space: string, verb: string) =>
                    auxiliary + space + alternatives[verb.toLowerCase()],
            );
        },
    },
    {
        id: "preposition-object",
        skill: "pronouns",
        ruleId: "pronoun-case",
        explanation: "The object of a preposition takes an object pronoun.",
        mutate(source) {
            const alternatives: Record<string, string> = {
                me: "I",
                him: "he",
                her: "she",
                us: "we",
                them: "they",
            };
            return source.replace(
                /\b(between|among|with|for|from|beside)(\s+)(me|him|her|us|them)\b/iu,
                (_, preposition: string, space: string, pronoun: string) =>
                    preposition + space + alternatives[pronoun.toLowerCase()],
            );
        },
    },
    {
        id: "article-sound",
        skill: "usage",
        ruleId: "article-sound",
        explanation: "Choose a or an from the following word’s opening sound.",
        mutate(source) {
            return source.replace(
                /\b(a|an)(\s+)(apple|orange|egg|idea|example|essay|error|hour|honest|honor|umbrella|important|interesting|unusual|animal|university|unicorn|user|useful|unique|one|book|student|sentence|teacher|dog|cat|house|year|European)\b/iu,
                (_, article: string, space: string, word: string) => {
                    const replacement = article.toLowerCase() === "a" ? "an" : "a";
                    return (
                        (/^[A-Z]/u.test(article)
                            ? replacement[0]!.toUpperCase() + replacement.slice(1)
                            : replacement) +
                        space +
                        word
                    );
                },
            );
        },
    },
    {
        id: "introductory-comma",
        skill: "punctuation",
        ruleId: "introductory-comma",
        explanation: "Separate an introductory transition from its main clause with a comma.",
        mutate(source) {
            return source.replace(/^(However|Therefore|Nevertheless|Moreover|Furthermore),/u, "$1");
        },
    },
    {
        id: "clause-boundary",
        skill: "boundaries",
        ruleId: "comma-splice",
        explanation:
            "A comma alone does not join these two independent clauses; preserve their semicolon boundary.",
        mutate(source) {
            return source.replace(/;/u, ",");
        },
    },
];
export function validatedMutation(
    source: string,
    operator: MutationOperator,
    id: string,
): Exercise | undefined {
    const original = pipeline.analyze(source);
    if (original.sentences.length !== 1 || original.diagnostics.length) return;
    const mutated = operator.mutate(source);
    if (!mutated || mutated === source) return;
    const report = pipeline.analyze(mutated),
        diagnostic = report.diagnostics.find(
            (d) => d.skill === operator.skill && d.ruleId === operator.ruleId,
        );
    if (report.diagnostics.length !== 1 || !diagnostic?.proposals[0]) return;
    const repaired = EssayDocument.create(mutated).apply(diagnostic.proposals[0]).text;
    if (repaired !== source || pipeline.analyze(repaired).diagnostics.length) return;
    const exercise: Exercise = {
        id,
        skill: operator.skill,
        type: "repair",
        prompt: `Repair the ${operator.skill.replace(/-/gu, " ")} error while preserving the rest of the sentence.`,
        sentence: mutated,
        options: [source, mutated],
        answer: 0,
        acceptedAnswers: [source],
        explanation: diagnostic.explanation,
        feedback: [diagnostic.explanation, operator.explanation],
        hints: [operator.explanation, diagnostic.explanation],
        difficulty: 2,
        source: {
            name: "Syntax controlled-mutation curriculum",
            quote: source,
            location: `${operator.id}@1.0.0/${id}`,
        },
        validation: "verified-mutation",
    };
    return validateExercise(exercise).length ? undefined : exercise;
}
export function buildMutationBank(): Exercise[] {
    const singular = [
        "collection of essays",
        "book on the desk",
        "student in the laboratory",
        "teacher with the students",
        "experiment with several results",
        "question about the findings",
        "lesson about the subject",
        "idea in the notes",
    ];
    const plural = [
        "students in the laboratory",
        "teachers with the students",
        "experiments with several results",
        "questions about the findings",
        "books on the desk",
        "lessons about the subject",
        "ideas in the notes",
        "results of the experiment",
    ];
    const bank: Exercise[] = [];
    for (const [number, subjects] of [
        ["singular", singular],
        ["plural", plural],
    ] as const)
        for (const [i, subject] of subjects.entries())
            for (const [j, complement] of [
                "ready",
                "useful",
                "interesting",
                "important",
            ].entries()) {
                const source = `The ${subject} ${number === "singular" ? "is" : "are"} ${complement}.`;
                const exercise = validatedMutation(
                    source,
                    mutationOperators[0]!,
                    `mutation:${number}:${i}:${j}`,
                );
                if (exercise) bank.push(exercise);
            }
    // These reviewed examples add different grammatical operations, rather than counting
    // adjective or noun substitutions as new constructions.
    const reviewed: Record<string, readonly string[]> = {
        "modal-base": [
            "She can write an essay.",
            "They should study the results.",
            "We must go home.",
            "He will work in the laboratory.",
        ],
        "perfect-participle": [
            "She has written three essays.",
            "They have eaten an apple.",
            "We had seen the results.",
            "He has taken the book.",
        ],
        "preposition-object": [
            "The teacher works with them.",
            "She has a book for him.",
            "The student walks beside her.",
            "They have a question for us.",
        ],
        "article-sound": [
            "She has an apple.",
            "He has a useful book.",
            "They have an unusual idea.",
            "We have a university nearby.",
        ],
        "introductory-comma": [
            "However, the students are ready.",
            "Therefore, the experiment is useful.",
            "Moreover, the results are important.",
            "Nevertheless, the teacher is ready.",
        ],
        "clause-boundary": [
            "I work; she works.",
            "She is ready; they are careful.",
            "We have the book; he has the notes.",
            "They are ready; we are careful.",
        ],
    };
    for (const operator of mutationOperators.slice(1))
        for (const [index, source] of (reviewed[operator.id] ?? []).entries()) {
            const exercise = validatedMutation(
                source,
                operator,
                `mutation:${operator.id}:${index}`,
            );
            if (exercise) bank.push(exercise);
        }
    return bank;
}
