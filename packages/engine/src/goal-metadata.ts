import type { AnalysisReport, Diagnostic, GoalMetadata, WritingIntent } from "./domain";
import { writingGoals } from "./goals";

const goalByRule: Readonly<Record<string, readonly string[]>> = {
    agreement: ["writing.agreement"],
    "neural-agreement": ["writing.agreement"],
    "verb-form": ["writing.irregular"],
    "neural-perfect-form": ["writing.irregular"],
    "article-sound": ["writing.articles"],
    "comma-splice": ["writing.runons", "writing.boundaries"],
    "run-on": ["writing.runons", "writing.boundaries"],
    "parsed-boundary": ["writing.runons", "writing.boundaries"],
    "parsed-dependent-fragment": ["writing.fragments", "writing.sentence"],
    "dependent-fragment": ["writing.fragments", "writing.sentence"],
    "pronoun-case": ["writing.pronouns"],
    "pronoun-reference": ["writing.pronouns"],
    "subject-case": ["writing.pronouns"],
    "double-comparison": ["writing.comparison"],
    "possessive-apostrophe": ["writing.possessive", "writing.editing"],
    "missing-contraction-apostrophe": ["writing.apostrophe", "writing.contractions"],
    "quotation-punctuation": ["writing.quotes"],
    spelling: ["writing.spelling", "writing.editing"],
    "dictionary-spelling": ["writing.spelling", "writing.editing"],
    "contextual-usage": ["writing.homophones"],
    "parallel-forms": ["writing.parallelism"],
    "modifier-attachment": ["writing.modifiers"],
    "document-repetition": ["writing.revision", "writing.concision"],
    "repeated-word": ["writing.concision"],
    "introductory-comma": ["writing.introductory-comma"],
    "introductory-clause-comma": ["writing.introductory-comma"],
    "missing-series-comma": ["writing.commas", "writing.list-punctuation"],
    "sentence-capitalization": ["writing.capitals", "writing.editing"],
    "missing-terminal-mark": ["writing.endmarks", "writing.editing"],
    "repeated-spacing": ["writing.spacing"],
    "colon-complement": ["writing.colons"],
    "semicolon-shared-subject": ["writing.semicolons"],
    "document-tense": ["writing.tense"],
};

function annotateDiagnostic(diagnostic: Diagnostic): Diagnostic {
    const goalId = goalByRule[diagnostic.ruleId]?.[0];
    return goalId ? { ...diagnostic, goalId } : diagnostic;
}

export function attachGoalMetadata(
    report: AnalysisReport,
    writingIntent: WritingIntent = report.writingIntent ?? "general",
): AnalysisReport {
    const diagnostics = report.diagnostics.map(annotateDiagnostic);
    const goalMetadata: GoalMetadata[] = writingGoals.map((goal) => ({
        id: goal.id,
        detection: goal.detection,
        proficiencyBand: goal.band,
        relevantToIntent: writingIntent === "general" || goal.intents.includes(writingIntent),
        diagnosticIds: diagnostics
            .filter(
                (diagnostic) =>
                    diagnostic.goalId === goal.id ||
                    (goalByRule[diagnostic.ruleId] ?? []).includes(goal.id),
            )
            .map((diagnostic) => diagnostic.id),
    }));
    return { ...report, writingIntent, diagnostics, goalMetadata };
}
