import type { Attempt, Exercise, SkillId, SkillState } from "./domain";

export const skills: readonly {
    id: SkillId;
    name: string;
    description: string;
    prerequisites: readonly SkillId[];
}[] = [
    {
        id: "sentence",
        name: "Sentence completeness",
        description: "Find a subject, a finite verb, and a complete thought.",
        prerequisites: [],
    },
    {
        id: "agreement",
        name: "Subject–verb agreement",
        description: "Connect a finite verb to its actual grammatical subject.",
        prerequisites: ["sentence"],
    },
    {
        id: "boundaries",
        name: "Clause boundaries",
        description: "Distinguish independent and dependent clauses.",
        prerequisites: ["sentence"],
    },
    {
        id: "punctuation",
        name: "Punctuation",
        description: "Use punctuation to make clause relationships visible.",
        prerequisites: ["boundaries"],
    },
    {
        id: "verb-forms",
        name: "Verb forms",
        description: "Choose base forms, finite verbs, and participles.",
        prerequisites: ["sentence"],
    },
    {
        id: "pronouns",
        name: "Pronoun case and reference",
        description: "Connect pronouns to their grammatical roles.",
        prerequisites: ["sentence"],
    },
    {
        id: "usage",
        name: "Spelling and usage",
        description: "Make precise, context-sensitive word choices.",
        prerequisites: [],
    },
];

export class SkillGraph {
    constructor(readonly nodes = skills) {
        this.validate();
    }
    private validate(): void {
        const active = new Set<SkillId>(),
            visited = new Set<SkillId>();
        const visit = (id: SkillId) => {
            if (active.has(id)) throw new Error("Skill prerequisites contain a cycle.");
            if (visited.has(id)) return;
            const node = this.nodes.find((n) => n.id === id);
            if (!node) throw new Error("Missing prerequisite.");
            active.add(id);
            node.prerequisites.forEach(visit);
            active.delete(id);
            visited.add(id);
        };
        this.nodes.forEach((n) => visit(n.id));
    }
}
export class ReviewScheduler {
    schedule(
        mastery: number,
        previousInterval: number,
        correct: boolean,
        now = new Date(),
    ): { due: string; interval: number } {
        const interval = correct
            ? Math.min(
                  365,
                  Math.max(1, Math.round(Math.max(1, previousInterval) * (1.5 + mastery))),
              )
            : 1;
        return { due: new Date(now.getTime() + interval * 86_400_000).toISOString(), interval };
    }
}
export class MasteryModel {
    constructor(
        private readonly scheduler = new ReviewScheduler(),
        private readonly transition = 0.12,
        private readonly slip = 0.1,
        private readonly guess = 0.25,
    ) {}
    initial(skill: SkillId, now = new Date()): SkillState {
        return {
            skill,
            mastery: 0.2,
            attempts: 0,
            correct: 0,
            due: now.toISOString(),
            interval: 0,
            lastExercise: null,
        };
    }
    update(state: SkillState, attempt: Attempt): SkillState {
        if (state.skill !== attempt.skill) throw new Error("Attempt belongs to a different skill.");
        const prior = state.mastery;
        const numerator = attempt.correct ? prior * (1 - this.slip) : prior * this.slip;
        const denominator =
            numerator + (1 - prior) * (attempt.correct ? this.guess : 1 - this.guess);
        const posterior = denominator ? numerator / denominator : prior;
        // A hinted answer provides learning opportunity but no positive mastery evidence.
        const evidence =
            (attempt.hints > 0 || (attempt.attemptNumber ?? 1) > 1) && attempt.correct
                ? prior
                : posterior;
        const mastery =
            (attempt.attemptNumber ?? 1) > 1 && attempt.correct
                ? prior
                : Math.min(1, Math.max(0, evidence + (1 - evidence) * this.transition));
        return {
            ...state,
            mastery,
            attempts: state.attempts + 1,
            correct:
                state.correct +
                Number(
                    attempt.correct && attempt.hints === 0 && (attempt.attemptNumber ?? 1) === 1,
                ),
            lastExercise: attempt.exerciseId,
            ...this.scheduler.schedule(
                mastery,
                state.interval,
                attempt.correct && attempt.hints === 0 && (attempt.attemptNumber ?? 1) === 1,
                new Date(attempt.at),
            ),
        };
    }
}
export class ExerciseSelector {
    select(
        bank: readonly Exercise[],
        states: readonly SkillState[],
        recent: readonly string[],
        skill?: SkillId,
        now = new Date(),
    ): Exercise | undefined {
        let candidates = bank.filter(
            (q) => (!skill || q.skill === skill) && !validateExercise(q).length,
        );
        // Prefer another construction, rather than a new ID on the same sentence template.
        const latest = bank.find((q) => q.id === recent[0]);
        const varied = latest
            ? candidates.filter((q) => exerciseFamily(q) !== exerciseFamily(latest))
            : candidates;
        if (varied.length) candidates = varied;
        const fresh = candidates.filter((q) => !recent.slice(0, 5).includes(q.id));
        if (fresh.length) candidates = fresh;
        if (!skill) {
            const queue = new ReviewQueue<SkillId>();
            for (const id of new Set(candidates.map((q) => q.skill))) {
                const state = states.find((s) => s.skill === id);
                const due = state ? Date.parse(state.due) : now.getTime();
                if (Number.isFinite(due) && due <= now.getTime()) queue.push(due, id);
            }
            const dueSkill = queue.pop()?.value;
            if (dueSkill) candidates = candidates.filter((q) => q.skill === dueSkill);
        }
        return [...candidates].sort(
            (a, b) =>
                this.score(b, states, recent, now) - this.score(a, states, recent, now) ||
                a.id.localeCompare(b.id),
        )[0];
    }
    private score(
        q: Exercise,
        states: readonly SkillState[],
        recent: readonly string[],
        now: Date,
    ): number {
        const state = states.find((s) => s.skill === q.skill);
        const mastery = state?.mastery ?? 0.2;
        const due = !state || new Date(state.due) <= now ? 1 : 0;
        const recency = recent.indexOf(q.id);
        const prereqs = skills.find((s) => s.id === q.skill)!.prerequisites;
        const missing = prereqs.filter(
            (p) => (states.find((s) => s.skill === p)?.mastery ?? 0.2) < 0.4,
        ).length;
        return (
            3 * (1 - mastery) +
            2 * due +
            4 * mastery * (1 - mastery) -
            missing * 0.8 -
            (recency >= 0 ? 12 - Math.min(8, recency) : 0) -
            Math.abs(q.difficulty - (mastery < 0.4 ? 1 : mastery < 0.7 ? 2 : 3)) * 0.3
        );
    }
}
/** Conservative construction groups: cosmetic changes never establish transfer. */
export function exerciseFamily(q: Exercise): string {
    const operator = /(?:^|; operator )([a-z][a-z-]+)@\d/u.exec(q.source.location)?.[1];
    if (operator) return `mutation:${operator}`;
    const prompt = q.prompt.replace(" (Practice a concept mentioned in your material.)", "");
    return `${q.skill}:${q.type ?? "choice"}:${prompt.replace(/\s+/gu, " ").trim().toLowerCase()}`;
}
export function validateExercise(q: Exercise): string[] {
    const errors: string[] = [];
    if (
        !q.id ||
        !q.prompt ||
        !q.explanation ||
        !q.source.name ||
        !q.source.quote ||
        !q.source.location
    )
        errors.push("Missing question content or provenance.");
    if (
        q.options.length < 2 ||
        q.options.length > 6 ||
        q.options.some((option) => !option.trim()) ||
        new Set(q.options.map((s) => s.trim().toLowerCase().replace(/\s+/gu, " "))).size !==
            q.options.length
    )
        errors.push("Options must be distinct.");
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length)
        errors.push("Invalid answer key.");
    if (q.feedback.length !== q.options.length || q.hints.length < 2)
        errors.push("Every option needs feedback and progressive hints.");
    if (q.feedback.some((feedback) => !feedback.trim()) || q.hints.some((hint) => !hint.trim()))
        errors.push("Feedback and hints must contain text.");
    if (
        q.type === "repair" &&
        (!q.acceptedAnswers?.length || !q.acceptedAnswers.includes(q.options[q.answer]!))
    )
        errors.push("A repair question needs an accepted keyed correction.");
    if (!skills.some((s) => s.id === q.skill)) errors.push("Unknown skill.");
    return errors;
}

export class ReviewQueue<T> {
    private readonly heap: { due: number; value: T }[] = [];
    get size(): number {
        return this.heap.length;
    }
    push(due: number, value: T): void {
        if (!Number.isFinite(due)) throw new Error("Review time must be finite.");
        const item = { due, value };
        this.heap.push(item);
        let i = this.heap.length - 1;
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (this.heap[parent]!.due <= due) break;
            this.heap[i] = this.heap[parent]!;
            i = parent;
        }
        this.heap[i] = item;
    }
    pop(): { due: number; value: T } | undefined {
        const first = this.heap[0],
            last = this.heap.pop();
        if (!this.heap.length || !last) return first;
        let i = 0;
        while (i * 2 + 1 < this.heap.length) {
            let child = i * 2 + 1;
            if (child + 1 < this.heap.length && this.heap[child + 1]!.due < this.heap[child]!.due)
                child++;
            if (this.heap[child]!.due >= last.due) break;
            this.heap[i] = this.heap[child]!;
            i = child;
        }
        this.heap[i] = last;
        return first;
    }
    due(now: number): T[] {
        const result: T[] = [];
        while (this.heap[0] && this.heap[0].due <= now) result.push(this.pop()!.value);
        return result;
    }
}
