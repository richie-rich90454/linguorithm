import { writingGoalCueRules } from "./writing-goal-cues";

const grammarGoalByRule: Readonly<Record<string, readonly string[]>> = {
    "count-noun-number": ["writing.plural"],
    agreement: ["writing.agreement"],
    "neural-agreement": ["writing.agreement"],
    "verb-form": ["writing.irregular"],
    "neural-perfect-form": ["writing.irregular"],
    "neural-modal-form": ["writing.irregular"],
    "article-sound": ["writing.articles"],
    "comma-splice": ["writing.runons", "writing.boundaries"],
    "run-on": ["writing.runons", "writing.boundaries"],
    "parsed-boundary": ["writing.runons", "writing.boundaries"],
    "parsed-dependent-fragment": ["writing.fragments", "writing.sentence"],
    "dependent-fragment": ["writing.fragments", "writing.sentence"],
    "pronoun-case": ["writing.pronoun-case"],
    "pronoun-reference": ["writing.pronouns", "writing.cohesion"],
    "subject-case": ["writing.pronoun-case"],
    "double-comparison": ["writing.comparison"],
    "possessive-apostrophe": ["writing.possessive", "writing.editing"],
    "missing-contraction-apostrophe": ["writing.apostrophe", "writing.contractions"],
    "quotation-punctuation": ["writing.quotes"],
    spelling: ["writing.spelling", "writing.editing"],
    "dictionary-spelling": ["writing.spelling", "writing.editing"],
    "contextual-usage": ["writing.homophones"],
    "parallel-forms": ["writing.parallelism"],
    "modifier-attachment": ["writing.modifiers"],
    "document-repetition": ["writing.sentence-variety"],
    "repeated-word": ["writing.concision"],
    "introductory-comma": ["writing.introductory-comma"],
    "introductory-clause-comma": ["writing.introductory-comma"],
    "missing-series-comma": ["writing.commas", "writing.list-punctuation"],
    "sentence-capitalization": ["writing.capitals", "writing.editing"],
    "missing-terminal-mark": ["writing.endmarks", "writing.editing"],
    "repeated-spacing": ["writing.spacing"],
    "missing-word-space": ["writing.spacing", "writing.spelling"],
    "colon-complement": ["writing.colons"],
    "semicolon-shared-subject": ["writing.semicolons"],
    "document-tense": ["writing.tense"],
    "gerund-complement": ["writing.gerunds"],
};

const writingCueGoalByRule = Object.fromEntries(
    writingGoalCueRules.map((rule) => [rule.id, [rule.goalId]]),
);

export const goalByRule: Readonly<Record<string, readonly string[]>> = {
    ...grammarGoalByRule,
    ...writingCueGoalByRule,
};

const goalDetectorIds: Record<string, readonly string[]> = {};
for (const [ruleId, goalIds] of Object.entries(goalByRule)) {
    for (const goalId of goalIds)
        goalDetectorIds[goalId] = [...(goalDetectorIds[goalId] ?? []), ruleId];
}

export const goalDetectorIdsByGoal: Readonly<Record<string, readonly string[]>> = goalDetectorIds;
export const detectableGoalIds: ReadonlySet<string> = new Set(Object.keys(goalDetectorIdsByGoal));
export const diagnosticGoalIds: ReadonlySet<string> = new Set(
    Object.values(grammarGoalByRule).flat(),
);
export const cueGoalIds: ReadonlySet<string> = new Set(
    writingGoalCueRules.map((rule) => rule.goalId),
);
