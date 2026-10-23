import type { Attempt } from "./domain";

export class ProgressExporter {
    csv(attempts: readonly Attempt[]): string {
        const cell = (value: unknown) => {
            const raw = String(value ?? "");
            const safe = /^[=+@\-\t\r\n]/u.test(raw) ? "'" + raw : raw;
            return `"${safe.replaceAll('"', '""')}"`;
        };
        const header = [
            "id",
            "exercise",
            "skill",
            "phase",
            "correct",
            "hints",
            "attempt",
            "difficulty",
            "durationMs",
            "at",
        ];
        return [
            header.map(cell).join(","),
            ...attempts.map((a) =>
                [
                    a.id,
                    a.exerciseId,
                    a.skill,
                    a.phase ?? "practice",
                    a.correct,
                    a.hints,
                    a.attemptNumber ?? 1,
                    a.difficulty ?? "",
                    a.durationMs ?? "",
                    a.at,
                ]
                    .map(cell)
                    .join(","),
            ),
        ].join("\r\n");
    }
}
