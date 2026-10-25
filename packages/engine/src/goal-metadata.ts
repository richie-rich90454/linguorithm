import type { AnalysisReport, Diagnostic, GoalMetadata, WritingIntent } from "./domain";
import { writingGoals } from "./goals";
import { goalByRule } from "./goal-rules";

const emptyDiagnosticIds: readonly string[] = Object.freeze([]);
const emptyMetadataByIntent = new Map<WritingIntent, readonly GoalMetadata[]>();

function annotateDiagnostic(diagnostic: Diagnostic): Diagnostic {
    const goalId = goalByRule[diagnostic.ruleId]?.[0];
    return goalId ? { ...diagnostic, goalId } : diagnostic;
}

function metadataWithoutFindings(writingIntent: WritingIntent): readonly GoalMetadata[] {
    const cached = emptyMetadataByIntent.get(writingIntent);
    if (cached) return cached;
    const metadata = Object.freeze(
        writingGoals.map((goal) =>
            Object.freeze({
                id: goal.id,
                detection: goal.detection,
                detectorMode: goal.detectorMode,
                detectorIds: goal.detectorIds,
                proficiencyBand: goal.band,
                relevantToIntent:
                    writingIntent === "general" || goal.intents.includes(writingIntent),
                diagnosticIds: emptyDiagnosticIds,
            }),
        ),
    );
    emptyMetadataByIntent.set(writingIntent, metadata);
    return metadata;
}

export function attachGoalMetadata(
    report: AnalysisReport,
    writingIntent: WritingIntent = report.writingIntent ?? "general",
): AnalysisReport {
    const diagnostics = report.diagnostics.length
        ? report.diagnostics.map(annotateDiagnostic)
        : report.diagnostics;
    if (!diagnostics.length)
        return {
            ...report,
            writingIntent,
            diagnostics,
            goalMetadata: metadataWithoutFindings(writingIntent),
        };

    const diagnosticIdsByGoal = new Map<string, string[]>();
    for (const diagnostic of diagnostics) {
        for (const goalId of goalByRule[diagnostic.ruleId] ?? []) {
            const ids = diagnosticIdsByGoal.get(goalId);
            if (ids) ids.push(diagnostic.id);
            else diagnosticIdsByGoal.set(goalId, [diagnostic.id]);
        }
    }
    const goalMetadata = metadataWithoutFindings(writingIntent).map((goal) => {
        const diagnosticIds = diagnosticIdsByGoal.get(goal.id);
        return diagnosticIds ? { ...goal, diagnosticIds } : goal;
    });
    return { ...report, writingIntent, diagnostics, goalMetadata };
}
