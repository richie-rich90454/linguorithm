import { assessmentSchema, type Assessment, type Attempt, type Exercise } from "./domain";
import { exerciseFamily, validateExercise } from "./learning";
export { ReviewQueue } from "./learning";

export class AssessmentService {
    start(
        phase: Assessment["phase"],
        bank: readonly Exercise[],
        attempts: readonly Attempt[],
        previous: readonly Assessment[],
        now = new Date(),
        size = 5,
    ): Assessment {
        if (!Number.isInteger(size) || size < 1 || size > 100)
            throw new Error("Assessment size must be an integer from 1 to 100.");
        const pretest = previous.find((s) => s.phase === "pretest" && s.completedAt);
        if (phase !== "pretest" && !pretest)
            throw new Error("Complete a pretest before a later assessment.");
        const posttest = previous.find((s) => s.phase === "posttest" && s.completedAt);
        if (
            phase === "delayed" &&
            (!posttest || now.getTime() < Date.parse(posttest.completedAt!) + 7 * 86_400_000)
        )
            throw new Error(
                "Delayed review becomes available seven days after a completed posttest.",
            );
        const used = new Set([
            ...attempts.map((a) => a.exerciseId),
            ...previous.flatMap((s) => s.exerciseIds),
        ]);
        const seenFamilies = new Set(bank.filter((q) => used.has(q.id)).map(exerciseFamily));
        const unique = [...new Map(bank.map((q) => [q.id, q])).values()];
        const eligible = unique.filter(
            (q) =>
                !used.has(q.id) &&
                !validateExercise(q).length &&
                (phase !== "transfer" ||
                    (q.difficulty >= 2 && !seenFamilies.has(exerciseFamily(q)))),
        );
        const groups = new Set<string>(),
            families = new Set<string>(),
            selected: Exercise[] = [];
        // Rotate skills and constructions before taking additional items from a family.
        for (const question of eligible)
            if (!groups.has(question.skill) && selected.length < size) {
                groups.add(question.skill);
                families.add(exerciseFamily(question));
                selected.push(question);
            }
        for (const question of eligible)
            if (!families.has(exerciseFamily(question)) && selected.length < size) {
                families.add(exerciseFamily(question));
                selected.push(question);
            }
        if (phase !== "transfer")
            for (const question of eligible)
                if (!selected.some((q) => q.id === question.id) && selected.length < size)
                    selected.push(question);
        if (selected.length < size)
            throw new Error(
                "There are not enough unseen, validated questions or unfamiliar constructions for this assessment. Add reviewed content before testing transfer.",
            );
        return assessmentSchema.parse({
            id: crypto.randomUUID(),
            phase,
            startedAt: now.toISOString(),
            dueAt: now.toISOString(),
            completedAt: null,
            exerciseIds: selected.map((q) => q.id),
            answers: [],
        });
    }
    answer(session: Assessment, question: Exercise, answer: number, now = new Date()): Assessment {
        if (
            session.completedAt ||
            !session.exerciseIds.includes(question.id) ||
            session.answers.some((a) => a.exerciseId === question.id) ||
            !Number.isInteger(answer) ||
            answer < 0 ||
            answer >= question.options.length
        )
            throw new Error("Invalid or repeated assessment answer.");
        const answers = [
            ...session.answers,
            {
                exerciseId: question.id,
                answer,
                correct: answer === question.answer,
                at: now.toISOString(),
            },
        ];
        return assessmentSchema.parse({
            ...session,
            answers,
            completedAt: answers.length === session.exerciseIds.length ? now.toISOString() : null,
        });
    }
    summary(sessions: readonly Assessment[]): {
        phase: string;
        completed: number;
        correct: number;
        total: number;
        accuracy: number | null;
    }[] {
        return (["pretest", "posttest", "delayed", "transfer"] as const).map((phase) => {
            const completed = sessions.filter((s) => s.phase === phase && s.completedAt),
                answers = completed.flatMap((s) => s.answers),
                correct = answers.filter((a) => a.correct).length;
            return {
                phase,
                completed: completed.length,
                correct,
                total: answers.length,
                accuracy: answers.length ? correct / answers.length : null,
            };
        });
    }
}
