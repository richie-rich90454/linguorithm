import type { AnalysisReport, Diagnostic, GoalMetadata, WritingIntent } from "./domain";
import { writingGoals } from "./goals";

const goalByRule: Readonly<Record<string, string>> = {
    agreement: "writing.agreement",
    "neural-agreement": "writing.agreement",
    "verb-form": "writing.irregular",
    "neural-perfect-form": "writing.irregular",
    "article-sound": "writing.articles",
    "comma-splice": "writing.runons",
    "run-on": "writing.runons",
    "parsed-boundary": "writing.runons",
    "parsed-dependent-fragment": "writing.fragments",
    "dependent-fragment": "writing.fragments",
    "pronoun-case": "writing.pronouns",
    "pronoun-reference": "writing.pronouns",
    "subject-case": "writing.pronouns",
    "double-comparison": "writing.comparison",
    "possessive-apostrophe": "writing.possessive",
    "quotation-punctuation": "writing.quotes",
    spelling: "writing.spelling",
    "dictionary-spelling": "writing.spelling",
    "contextual-usage": "writing.homophones",
    "parallel-forms": "writing.parallelism",
    "modifier-attachment": "writing.modifiers",
    "document-repetition": "writing.revision",
    "repeated-word": "writing.concision",
    "introductory-comma": "writing.introductory-comma",
    "introductory-clause-comma": "writing.introductory-comma",
    "colon-complement": "writing.colons",
    "semicolon-shared-subject": "writing.semicolons",
    "document-tense": "writing.tense",
};

function annotateDiagnostic(diagnostic: Diagnostic): Diagnostic {
    const goalId = goalByRule[diagnostic.ruleId];
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
            .filter((diagnostic) => diagnostic.goalId === goal.id)
            .map((diagnostic) => diagnostic.id),
    }));
    return { ...report, writingIntent, diagnostics, goalMetadata };
}
