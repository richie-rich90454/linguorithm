import { For, Show, createEffect, createSignal } from "solid-js";
import {
    skills,
    type Assessment,
    type Exercise,
    type SkillId,
    type SkillState,
} from "@grammar/engine";
import { Icon } from "./icons";

export function Practice(props: {
    question?: Exercise;
    assessment?: Assessment;
    sourceQuiz?: boolean;
    states: readonly SkillState[];
    filter?: SkillId;
    onFilter: (s?: SkillId) => void;
    onNext: () => void;
    onRepairs: () => void;
    onAnswer: (
        q: Exercise,
        answer: number,
        hints: number,
        durationMs: number,
        responseText?: string,
    ) => Promise<void>;
    onError: (e: unknown) => void;
}) {
    const [selected, setSelected] = createSignal<number>();
    const [response, setResponse] = createSignal("");
    let started = performance.now();
    const [answered, setAnswered] = createSignal(false);
    const [hints, setHints] = createSignal(0);
    const [saving, setSaving] = createSignal(false);
    const [session, setSession] = createSignal({ attempted: 0, correct: 0 });
    createEffect(() => {
        const id = props.question?.id;
        if (id) {
            setSelected(undefined);
            setAnswered(false);
            setHints(0);
            setResponse("");
            started = performance.now();
        }
    });
    async function submit() {
        const q = props.question,
            answer =
                q?.type === "repair"
                    ? q.acceptedAnswers?.some(
                          (a) =>
                              a.trim().replace(/\s+/gu, " ") ===
                              response().trim().replace(/\s+/gu, " "),
                      )
                        ? q.answer
                        : q.options.findIndex((_, i) => i !== q.answer)
                    : selected();
        if (!q || answer === undefined || answered() || saving()) return;
        setSaving(true);
        try {
            setSelected(answer);
            await props.onAnswer(
                q,
                answer,
                hints(),
                performance.now() - started,
                q.type === "repair" ? response() : undefined,
            );
            if (props.question !== q) return;
            setAnswered(true);
            setSession({
                attempted: session().attempted + 1,
                correct: session().correct + Number(answer === q.answer),
            });
        } catch (e) {
            props.onError(e);
        } finally {
            setSaving(false);
        }
    }
    return (
        <div class="practice-layout">
            <aside class="skill-menu">
                <h2>Choose your focus</h2>
                <button class="skill-menu-item" onClick={props.onRepairs}>
                    Sentence repairs <Icon name="arrow" size={16} />
                </button>
                <button
                    classList={{ "skill-menu-item": true, selected: !props.filter }}
                    onClick={() => props.onFilter(undefined)}
                >
                    <span>Adaptive mix</span>
                    <Icon name="arrow" size={16} />
                </button>
                <For each={skills}>
                    {(skill) => (
                        <button
                            classList={{
                                "skill-menu-item": true,
                                selected: props.filter === skill.id,
                            }}
                            onClick={() => props.onFilter(skill.id)}
                        >
                            <span>{skill.name}</span>
                            <span class="skill-attempts">
                                {props.states.find((s) => s.skill === skill.id)?.attempts ?? 0}
                            </span>
                        </button>
                    )}
                </For>
                <p class="skill-menu-note">
                    Practice favors skills with less evidence of mastery, due reviews, and
                    unfamiliar constructions.
                </p>
            </aside>
            <section class="practice-main">
                <div class="practice-meta">
                    <span>
                        {props.assessment
                            ? `${props.assessment.phase} · ${props.assessment.answers.length}/${props.assessment.exerciseIds.length}`
                            : "Guided practice"}
                    </span>
                    <span>
                        {session().attempted
                            ? `${session().correct} of ${session().attempted} correct this session`
                            : "Take your time. Reason it through."}
                    </span>
                </div>
                <Show
                    when={props.question}
                    fallback={
                        <div class="empty-state">
                            <h2>
                                {props.sourceQuiz
                                    ? "You’ve completed this source quiz."
                                    : props.assessment
                                      ? "Assessment complete."
                                      : "No questions for this focus."}
                            </h2>
                            <p>
                                {props.sourceQuiz
                                    ? "Your responses are recorded. Return later to check what you remember."
                                    : "Choose another skill or import material with supported examples."}
                            </p>
                            <button
                                class="button secondary"
                                onClick={() => props.onFilter(undefined)}
                            >
                                Return to adaptive practice <Icon name="arrow" size={16} />
                            </button>
                        </div>
                    }
                >
                    {(q) => (
                        <>
                            <div class="practice-question">
                                <div class="question-label">
                                    <span>{skills.find((s) => s.id === q().skill)?.name}</span>
                                    <span>Level {q().difficulty} / 3</span>
                                </div>
                                <h2>{q().prompt}</h2>
                                <p class="question-sentence">{q().sentence}</p>
                                <Show when={q().type === "repair"}>
                                    <label for="repair-answer">Your repaired sentence</label>
                                    <textarea
                                        id="repair-answer"
                                        rows="3"
                                        maxlength="10000"
                                        value={response()}
                                        disabled={answered() || saving()}
                                        onInput={(e) => setResponse(e.currentTarget.value)}
                                    />
                                    <p class="small-print">
                                        Accepted responses preserve the sentence and repair the
                                        target error. Other valid rewrites may require human review.
                                    </p>
                                </Show>
                                <Show when={q().type !== "repair" || answered()}>
                                    <fieldset
                                        class="answer-options"
                                        disabled={answered() || saving()}
                                    >
                                        <legend class="sr-only">Choose your answer</legend>
                                        <For each={q().options}>
                                            {(option, i) => (
                                                <label
                                                    classList={{
                                                        "answer-option": true,
                                                        selected: selected() === i(),
                                                        correct: answered() && q().answer === i(),
                                                        incorrect:
                                                            answered() &&
                                                            selected() === i() &&
                                                            q().answer !== i(),
                                                    }}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="answer"
                                                        value={i()}
                                                        checked={selected() === i()}
                                                        onChange={() => setSelected(i())}
                                                    />
                                                    <span class="option-letter">
                                                        {String.fromCharCode(65 + i())}
                                                    </span>
                                                    <span>{option}</span>
                                                    <Show when={answered() && q().answer === i()}>
                                                        <Icon name="check" size={18} />
                                                    </Show>
                                                </label>
                                            )}
                                        </For>
                                    </fieldset>
                                </Show>
                                <Show when={hints() > 0 && !answered()}>
                                    <div class="hint-box" role="status">
                                        <span>Hint {hints()}</span>
                                        <p>{q().hints[hints() - 1]}</p>
                                    </div>
                                </Show>
                                <Show when={answered()}>
                                    <div
                                        classList={{
                                            "answer-feedback": true,
                                            "answer-feedback-correct": selected() === q().answer,
                                        }}
                                        role="status"
                                    >
                                        <h3>
                                            {selected() === q().answer
                                                ? "That’s the relationship."
                                                : "Let’s look at the relationship."}
                                        </h3>
                                        <p>{q().feedback[selected()!]}</p>
                                        <Show when={hints() > 0}>
                                            <small>
                                                A hinted answer is recorded separately from
                                                independent success.
                                            </small>
                                        </Show>
                                    </div>
                                </Show>
                                <div class="question-actions">
                                    <Show
                                        when={!answered()}
                                        fallback={
                                            <button class="button primary" onClick={props.onNext}>
                                                Try a new construction{" "}
                                                <Icon name="arrow" size={18} />
                                            </button>
                                        }
                                    >
                                        <button
                                            class="button primary"
                                            disabled={
                                                (q().type === "repair"
                                                    ? !response().trim()
                                                    : selected() === undefined) || saving()
                                            }
                                            onClick={() => void submit()}
                                        >
                                            {saving() ? "Recording…" : "Check my reasoning"}
                                            <Icon name="arrow" size={17} />
                                        </button>
                                        <button
                                            class="text-button"
                                            disabled={
                                                !!props.assessment || hints() >= q().hints.length
                                            }
                                            onClick={() => setHints(hints() + 1)}
                                        >
                                            {hints() ? "A more specific hint" : "Give me a hint"}
                                        </button>
                                    </Show>
                                </div>
                            </div>
                            <Show when={!props.assessment || answered()}>
                                <details class="question-source">
                                    <summary>
                                        Where this question comes from <span>↗</span>
                                    </summary>
                                    <p>
                                        {q().source.name} · {q().source.location}
                                    </p>
                                    <blockquote>{q().source.quote}</blockquote>
                                    <p>
                                        Validation: {q().validation}.{" "}
                                        {q().validation === "authored"
                                            ? "Editorially authored; independent educator review is still recommended."
                                            : "Deterministically constructed from your imported source."}
                                    </p>
                                </details>
                            </Show>
                        </>
                    )}
                </Show>
            </section>
        </div>
    );
}
