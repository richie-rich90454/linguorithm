import type { AnalysisReport, Diagnostic, GoalMetadata, WritingIntent } from "./domain";
import { writingGoals } from "./goals";
import { goalByRule } from "./goal-rules";

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
