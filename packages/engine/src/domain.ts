import { z } from "zod";

export const MAX_TEXT = 150_000;
export type Span = Readonly<{ start: number; end: number }>;
export type Category = "Grammar" | "Punctuation" | "Spelling" | "Usage" | "Style";
export type Certainty = "Confirmed error" | "Likely error" | "Possible issue" | "Style suggestion";
export type SkillId =
    | "sentence"
    | "agreement"
    | "boundaries"
    | "verb-forms"
    | "pronouns"
    | "usage"
    | "punctuation";
export type Pos =
    | "NOUN"
    | "VERB"
    | "AUX"
    | "PRON"
    | "DET"
    | "ADJ"
    | "ADV"
    | "ADP"
    | "CCONJ"
    | "SCONJ"
    | "PUNCT"
    | "NUM"
    | "PROPN"
    | "PART"
    | "INTJ"
    | "SYM"
    | "X";
export interface Morphology {
    lemma: string;
    pos: Pos;
    number?: "singular" | "plural";
    finite?: boolean;
    verbForm?: string;
    tense?: string;
}
export interface Token extends Span {
    text: string;
    analyses: readonly Morphology[];
    pos: Pos;
}
export interface Dependency {
    head: number;
    dependent: number;
    relation: string;
}
export interface Sentence extends Span {
    id: string;
    text: string;
    tokens: readonly Token[];
    graph: readonly Dependency[];
    ambiguous: boolean;
    alternatives?: readonly { graph: readonly Dependency[]; score: number }[];
    syntaxSource?: "lexical" | "neural";
}
export interface Edit extends Span {
    type: "KEEP" | "INSERT" | "DELETE" | "REPLACE" | "INFLECT" | "REORDER" | "SPLIT" | "MERGE";
    expected: string;
    replacement: string;
}
export interface CorrectionProposal {
    id: string;
    edits: readonly Edit[];
    label: string;
    provenance: string;
    validation?: { status: "rechecked"; checks: readonly string[] };
}
export interface Diagnostic extends Span {
    id: string;
    ruleId: string;
    category: Category;
    skill: SkillId;
    title: string;
    explanation: string;
    certainty: Certainty;
    evidence: readonly (Span & { label: string })[];
    confidence: { policy: string; calibrated: boolean; probability?: number; scope?: string };
    proposals: readonly CorrectionProposal[];
}
export interface AnalysisReport {
    revision: number;
    text: string;
    sentences: readonly Sentence[];
    diagnostics: readonly Diagnostic[];
    elapsedMs: number;
    cachedParagraphs: number;
    versions: Record<string, string>;
    limitations: readonly string[];
    modelStatus?: {
        state: "ready" | "unavailable" | "disabled";
        detail: string;
        tasks: readonly string[];
    };
}

const revisionSchema = z.object({
    text: z.string().max(MAX_TEXT),
    reason: z.string().max(250),
    at: z.string().datetime(),
});
export const documentSchema = z
    .object({
        id: z.string().min(1).max(100),
        title: z.string().min(1).max(200),
        revisions: z.array(revisionSchema).min(1).max(500),
        cursor: z.number().int().nonnegative(),
        updatedAt: z.string().datetime(),
    })
    .refine((d) => d.cursor < d.revisions.length, "Invalid revision cursor");
export type DocumentRecord = z.infer<typeof documentSchema>;

export class EssayDocument {
    constructor(readonly record: DocumentRecord) {}
    static create(text = "", title = "Untitled essay"): EssayDocument {
        const at = new Date().toISOString();
        return new EssayDocument(
            documentSchema.parse({
                id: crypto.randomUUID(),
                title,
                revisions: [{ text, reason: "Original", at }],
                cursor: 0,
                updatedAt: at,
            }),
        );
    }
    get text(): string {
        return this.record.revisions[this.record.cursor]!.text;
    }
    private nextTimestamp(): string {
        return new Date(Math.max(Date.now(), Date.parse(this.record.updatedAt) + 1)).toISOString();
    }
    revise(text: string, reason: string): EssayDocument {
        if (text.length > MAX_TEXT) throw new Error("Documents are limited to 150,000 characters.");
        if (text === this.text) return this;
        const at = this.nextTimestamp();
        const revisions = [
            ...this.record.revisions.slice(0, this.record.cursor + 1),
            { text, reason, at },
        ];
        if (revisions.length > 500)
            throw new Error("Revision limit reached. Export a backup and start a new document.");
        return new EssayDocument({
            ...this.record,
            revisions,
            cursor: revisions.length - 1,
            updatedAt: at,
        });
    }
    undo(): EssayDocument {
        return new EssayDocument({
            ...this.record,
            cursor: Math.max(0, this.record.cursor - 1),
            updatedAt: this.nextTimestamp(),
        });
    }
    redo(): EssayDocument {
        return new EssayDocument({
            ...this.record,
            cursor: Math.min(this.record.revisions.length - 1, this.record.cursor + 1),
            updatedAt: this.nextTimestamp(),
        });
    }
    apply(proposal: CorrectionProposal): EssayDocument {
        const edits = [...proposal.edits].sort((a, b) => b.start - a.start);
        let text = this.text;
        let boundary = text.length + 1;
        for (const edit of edits) {
            if (
                !Number.isInteger(edit.start) ||
                !Number.isInteger(edit.end) ||
                edit.start < 0 ||
                edit.end < edit.start ||
                edit.end > this.text.length ||
                edit.end >= boundary ||
                this.text.slice(edit.start, edit.end) !== edit.expected
            )
                throw new Error(
                    "This correction is stale or contains conflicting edits. Analyze the current revision again.",
                );
            text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
            boundary = edit.start;
        }
        return this.revise(text, proposal.label);
    }
}

export const skillStateSchema = z
    .object({
        skill: z.enum([
            "sentence",
            "agreement",
            "boundaries",
            "verb-forms",
            "pronouns",
            "usage",
            "punctuation",
        ]),
        mastery: z.number().min(0).max(1),
        attempts: z.number().int().nonnegative(),
        correct: z.number().int().nonnegative(),
        due: z.string().datetime(),
        interval: z.number().min(0).max(365),
        lastExercise: z.string().nullable(),
    })
    .refine((s) => s.correct <= s.attempts);
export type SkillState = z.infer<typeof skillStateSchema>;
export const attemptSchema = z.object({
    id: z.string(),
    exerciseId: z.string(),
    skill: skillStateSchema.shape.skill,
    answer: z.number().int().nonnegative(),
    correct: z.boolean(),
    hints: z.number().int().nonnegative(),
    at: z.string().datetime(),
    attemptNumber: z.number().int().min(1).optional(),
    phase: z.enum(["practice", "pretest", "posttest", "delayed", "transfer"]).optional(),
    difficulty: z.number().int().min(1).max(3).optional(),
    durationMs: z.number().finite().min(0).max(3_600_000).optional(),
    responseText: z.string().max(10_000).optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;
export interface Exercise {
    id: string;
    skill: SkillId;
    prompt: string;
    sentence: string;
    options: readonly string[];
    answer: number;
    explanation: string;
    feedback: readonly string[];
    hints: readonly string[];
    difficulty: 1 | 2 | 3;
    source: { name: string; quote: string; location: string };
    validation: "authored" | "source-matched" | "verified-mutation";
    type?: "choice" | "repair" | "diagnosis";
    acceptedAnswers?: readonly string[];
}
export const materialSchema = z.object({
    id: z.string(),
    name: z.string().max(250),
    text: z.string().max(MAX_TEXT),
    importedAt: z.string().datetime(),
    format: z.string().max(30),
});
export type Material = z.infer<typeof materialSchema>;
export const preferenceSchema = z.object({
    key: z.enum(["models", "dictionary", "variety", "server-url"]),
    value: z.union([z.boolean(), z.string().max(1000), z.array(z.string().max(100)).max(10_000)]),
    updatedAt: z.string().datetime(),
});
export type Preference = z.infer<typeof preferenceSchema>;
export const assessmentSchema = z
    .object({
        id: z.string().min(1).max(100),
        phase: z.enum(["pretest", "posttest", "delayed", "transfer"]),
        startedAt: z.string().datetime(),
        completedAt: z.string().datetime().nullable(),
        dueAt: z.string().datetime(),
        exerciseIds: z.array(z.string().max(200)).min(1).max(100),
        answers: z
            .array(
                z.object({
                    exerciseId: z.string().max(200),
                    answer: z.number().int().nonnegative(),
                    correct: z.boolean(),
                    at: z.string().datetime(),
                }),
            )
            .max(100),
    })
    .superRefine((s, ctx) => {
        if (
            new Set(s.exerciseIds).size !== s.exerciseIds.length ||
            new Set(s.answers.map((a) => a.exerciseId)).size !== s.answers.length ||
            s.answers.some((a) => !s.exerciseIds.includes(a.exerciseId))
        )
            ctx.addIssue({
                code: "custom",
                message: "Invalid assessment question/answer identities",
            });
        if (
            (s.completedAt !== null &&
                (s.answers.length !== s.exerciseIds.length ||
                    Date.parse(s.completedAt) < Date.parse(s.startedAt))) ||
            s.answers.some((a) => Date.parse(a.at) < Date.parse(s.startedAt))
        )
            ctx.addIssue({
                code: "custom",
                message: "Assessment completion or answer time is inconsistent.",
            });
    });
export type Assessment = z.infer<typeof assessmentSchema>;
export const modelRecordSchema = z.object({
    id: z.string().max(100),
    version: z.string().max(100),
    status: z.enum(["ready", "unavailable", "disabled"]),
    detail: z.string().max(5000),
    at: z.string().datetime(),
});
export type ModelRecord = z.infer<typeof modelRecordSchema>;
export const backupSchema = z
    .object({
        format: z.literal("syntax-backup"),
        version: z.union([z.literal(1), z.literal(2)]),
        exportedAt: z.string().datetime(),
        documents: z.array(documentSchema).max(100),
        skills: z.array(skillStateSchema).max(100),
        attempts: z.array(attemptSchema).max(50_000),
        materials: z.array(materialSchema).max(100),
        preferences: z.array(preferenceSchema).max(100).optional(),
        assessments: z.array(assessmentSchema).max(1000).optional(),
        models: z.array(modelRecordSchema).max(100).optional(),
    })
    .superRefine((data, ctx) => {
        for (const key of ["documents", "skills", "attempts", "materials"] as const) {
            const ids = data[key].map((item) => ("id" in item ? item.id : item.skill));
            if (new Set(ids).size !== ids.length)
                ctx.addIssue({ code: "custom", message: `Duplicate ${key} identifiers` });
        }
        for (const key of ["preferences", "assessments", "models"] as const) {
            const ids = data[key]?.map((item) => ("id" in item ? item.id : item.key)) ?? [];
            if (new Set(ids).size !== ids.length)
                ctx.addIssue({ code: "custom", message: `Duplicate ${key} identifiers` });
        }
    });
export type Backup = z.infer<typeof backupSchema>;
