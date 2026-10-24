import Dexie, { type EntityTable } from "dexie";
import {
    backupSchema,
    MasteryModel,
    type Attempt,
    type Backup,
    type DocumentRecord,
    type Material,
    type SkillState,
    type Preference,
    type Assessment,
    type ModelRecord,
} from "@grammar/engine";

const db = new Dexie("syntax-local") as Dexie & {
    documents: EntityTable<DocumentRecord, "id">;
    skills: EntityTable<SkillState, "skill">;
    attempts: EntityTable<Attempt, "id">;
    materials: EntityTable<Material, "id">;
    preferences: EntityTable<Preference, "key">;
    assessments: EntityTable<Assessment, "id">;
    models: EntityTable<ModelRecord, "id">;
    reports: EntityTable<
        {
            id: string;
            documentId: string;
            revision: number;
            report: import("@grammar/engine").AnalysisReport;
            at: string;
        },
        "id"
    >;
};
db.version(1).stores({
    documents: "id, updatedAt",
    skills: "skill, due",
    attempts: "id, exerciseId, at",
    materials: "id, importedAt",
});
db.version(2)
    .stores({
        documents: "id, updatedAt",
        skills: "skill, due",
        attempts: "id, exerciseId, at, phase",
        materials: "id, importedAt",
        preferences: "key, updatedAt",
        assessments: "id, phase, completedAt",
        models: "id, at",
        reports: "id, documentId, at",
    })
    .upgrade(async (transaction) => {
        const attempts = (await transaction.table("attempts").orderBy("at").toArray()) as Attempt[];
        attempts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
        const counts = new Map<string, number>();
        for (const record of attempts) {
            const count = (counts.get(record.exerciseId) ?? 0) + 1;
            counts.set(record.exerciseId, count);
            record.phase ??= "practice";
            record.attemptNumber ??= count;
        }
        await transaction.table("attempts").bulkPut(attempts);
    });
export { db };
// Explicit factual definitions support source recall, not evidence of grammar skill.
// This identity is also available on older attempts imported from backups.
export function contributesToGrammarMastery(exerciseId: string): boolean {
    return !/^material:.*:explicit:\d+$/u.test(exerciseId);
}
async function replayGrammarMastery(
    allAttempts: readonly Attempt[],
    repairFactualOnly = false,
): Promise<void> {
    const mastery = new MasteryModel();
    const replay = new Map<string, SkillState>();
    const practiceCounts = new Map<string, number>();
    const factualSkills = new Set<SkillState["skill"]>();
    for (const attempt of allAttempts.filter((a) => (a.phase ?? "practice") === "practice")) {
        practiceCounts.set(attempt.skill, (practiceCounts.get(attempt.skill) ?? 0) + 1);
        if (!contributesToGrammarMastery(attempt.exerciseId)) factualSkills.add(attempt.skill);
        else
            replay.set(
                attempt.skill,
                mastery.update(
                    replay.get(attempt.skill) ??
                        mastery.initial(attempt.skill, new Date(attempt.at)),
                    attempt,
                ),
            );
    }
    for (const state of replay.values()) {
        if (repairFactualOnly && !factualSkills.has(state.skill)) continue;
        const local = await db.skills.get(state.skill);
        if (
            !local ||
            state.attempts >= local.attempts ||
            (factualSkills.has(state.skill) &&
                (practiceCounts.get(state.skill) ?? 0) >= local.attempts)
        )
            await db.skills.put(state);
    }
    // Older data may include grammar estimates derived from factual recall.
    // Repair them when the recorded history fully accounts for their attempts.
    for (const skill of factualSkills) {
        if (replay.has(skill)) continue;
        const local = await db.skills.get(skill);
        if (local && (practiceCounts.get(skill) ?? 0) >= local.attempts)
            await db.skills.delete(local.skill);
    }
}
export async function reconcileGrammarMastery(): Promise<void> {
    await db.transaction("rw", [db.skills, db.attempts], async () => {
        const attempts = await db.attempts.toArray();
        attempts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
        await replayGrammarMastery(attempts, true);
    });
}
export async function saveDocument(record: DocumentRecord): Promise<void> {
    await db.transaction("rw", db.documents, async () => {
        const saved = await db.documents.get(record.id);
        if (!saved && (await db.documents.count()) >= 100)
            throw new Error(
                "This workspace has reached its limit of 100 documents. Export your work before starting a new workspace.",
            );
        if (
            saved &&
            (Date.parse(saved.updatedAt) > Date.parse(record.updatedAt) ||
                (Date.parse(saved.updatedAt) === Date.parse(record.updatedAt) &&
                    JSON.stringify(saved) !== JSON.stringify(record)))
        )
            throw new Error(
                "A newer or conflicting document is already saved. Export your current text and reopen the saved document before editing again.",
            );
        await db.documents.put(record);
    });
}
export async function exportBackup(): Promise<Backup> {
    return db.transaction(
        "r",
        [
            db.documents,
            db.skills,
            db.attempts,
            db.materials,
            db.preferences,
            db.assessments,
            db.models,
        ],
        async () =>
            backupSchema.parse({
                format: "syntax-backup",
                version: 2,
                exportedAt: new Date().toISOString(),
                documents: await db.documents.toArray(),
                skills: await db.skills.toArray(),
                attempts: await db.attempts.toArray(),
                materials: await db.materials.toArray(),
                preferences: await db.preferences.toArray(),
                assessments: await db.assessments.toArray(),
                models: await db.models.toArray(),
            }),
    );
}
export async function restoreBackup(raw: unknown): Promise<void> {
    const data = backupSchema.parse(raw);
    await db.transaction(
        "rw",
        [
            db.documents,
            db.skills,
            db.attempts,
            db.materials,
            db.preferences,
            db.assessments,
            db.models,
        ],
        async () => {
            // A schema-valid backup can still overflow the combined local collection.
            // Check every union inside the same write transaction before changing any record.
            const collections = [
                {
                    table: db.documents,
                    keys: data.documents.map((record) => record.id),
                    limit: 100,
                    label: "documents",
                },
                {
                    table: db.materials,
                    keys: data.materials.map((record) => record.id),
                    limit: 100,
                    label: "materials",
                },
                {
                    table: db.attempts,
                    keys: data.attempts.map((record) => record.id),
                    limit: 50_000,
                    label: "attempts",
                },
                {
                    table: db.assessments,
                    keys: (data.assessments ?? []).map((record) => record.id),
                    limit: 1000,
                    label: "assessments",
                },
                {
                    table: db.models,
                    keys: (data.models ?? []).map((record) => record.id),
                    limit: 100,
                    label: "model records",
                },
                {
                    table: db.preferences,
                    keys: (data.preferences ?? []).map((record) => record.key),
                    limit: 100,
                    label: "preferences",
                },
            ];
            for (const { table, keys, limit, label } of collections) {
                const merged = new Set(await table.toCollection().primaryKeys());
                for (const key of keys) merged.add(key);
                if (merged.size > limit)
                    throw new Error(
                        `Restore would exceed this device's limit of ${limit.toLocaleString("en-US")} ${label}. Use a smaller backup or a separate browser profile. No backup records were restored.`,
                    );
            }
            // Additive restore: keep the newer local record when identifiers collide.
            for (const document of data.documents) {
                const local = await db.documents.get(document.id);
                if (!local || Date.parse(document.updatedAt) > Date.parse(local.updatedAt))
                    await db.documents.put(document);
            }
            for (const skill of data.skills) {
                const local = await db.skills.get(skill.skill);
                if (!local || skill.attempts > local.attempts) await db.skills.put(skill);
            }
            for (const attempt of data.attempts)
                if (!(await db.attempts.get(attempt.id))) await db.attempts.add(attempt);
            for (const material of data.materials) {
                const local = await db.materials.get(material.id);
                if (!local || Date.parse(material.importedAt) > Date.parse(local.importedAt))
                    await db.materials.put(material);
            }
            const allAttempts = await db.attempts.orderBy("at").toArray(),
                counts = new Map<string, number>();
            allAttempts.sort(
                (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
            );
            for (const attempt of allAttempts) {
                const count = (counts.get(attempt.exerciseId) ?? 0) + 1;
                counts.set(attempt.exerciseId, count);
                attempt.attemptNumber = count;
                attempt.phase ??= "practice";
            }
            await db.attempts.bulkPut(allAttempts);
            await replayGrammarMastery(allAttempts);
            for (const preference of data.preferences ?? []) {
                const local = await db.preferences.get(preference.key);
                if (!local || Date.parse(preference.updatedAt) > Date.parse(local.updatedAt))
                    await db.preferences.put(preference);
            }
            for (const assessment of data.assessments ?? []) {
                const local = await db.assessments.get(assessment.id);
                if (!local) await db.assessments.put(assessment);
                else {
                    if (
                        local.phase !== assessment.phase ||
                        local.exerciseIds.join("\0") !== assessment.exerciseIds.join("\0")
                    )
                        throw new Error("A restored assessment conflicts with its local identity.");
                    const answers = [
                        ...local.answers,
                        ...assessment.answers.filter(
                            (a) => !local.answers.some((b) => a.exerciseId === b.exerciseId),
                        ),
                    ];
                    const completedAt =
                        answers.length === local.exerciseIds.length
                            ? answers
                                  .map((a) => a.at)
                                  .sort((a, b) => Date.parse(a) - Date.parse(b))
                                  .at(-1)!
                            : null;
                    await db.assessments.put({ ...local, answers, completedAt });
                }
            }
            for (const model of data.models ?? []) {
                const local = await db.models.get(model.id);
                if (!local || Date.parse(model.at) > Date.parse(local.at))
                    await db.models.put(model);
            }
        },
    );
}
export function download(name: string, content: string, type = "text/plain"): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
