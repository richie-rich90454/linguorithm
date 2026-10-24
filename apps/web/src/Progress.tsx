import { For, Show, createMemo } from "solid-js";
import {
    AssessmentService,
    skills,
    type Assessment,
    type Attempt,
    type SkillId,
    type SkillState,
} from "@grammar/engine";
import { Icon } from "./icons";
import { contributesToGrammarMastery } from "./persistence";
import { WritingGoalMap } from "./WritingGoalMap";

export function Progress(props: {
    states: readonly SkillState[];
    attempts: readonly Attempt[];
    assessments: readonly Assessment[];
    onAssessment: (phase: Assessment["phase"]) => void;
    onExport: () => void;
    onPractice: (skill?: SkillId) => void;
    onBackup: () => void;
    onRestore: () => void;
}) {
    const independent = createMemo(() =>
        props.attempts.filter(
            (a) =>
                a.hints === 0 &&
                (a.attemptNumber ?? 1) === 1 &&
                contributesToGrammarMastery(a.exerciseId) &&
                (a.phase ?? "practice") === "practice",
        ),
    );
    const accuracy = createMemo(() =>
        independent().length
            ? Math.round(
                  (independent().filter((a) => a.correct).length / independent().length) * 100,
              )
            : undefined,
    );
    const due = createMemo(() => props.states.filter((s) => new Date(s.due) <= new Date()));
    return (
        <section class="progress-page">
            <details class="question-source">
                <summary>Measure retention and transfer</summary>
                <p>
                    Assessments use unseen validated items and do not update mastery. Complete a
                    pretest first; delayed testing opens seven days after a posttest. These records
                    support evaluation; they do not establish a learning benefit.
                </p>
                <div class="button-row">
                    <For each={new AssessmentService().summary(props.assessments)}>
                        {(s) => (
                            <button
                                class="button secondary"
                                onClick={() => props.onAssessment(s.phase as Assessment["phase"])}
                            >
                                {s.phase} ·{" "}
                                {s.total ? `${s.correct}/${s.total}` : "Start or resume"}
                            </button>
                        )}
                    </For>
                </div>
                <button class="text-button" onClick={props.onExport}>
                    Export attempt records as CSV
                </button>
            </details>
            <div class="progress-summary">
                <div>
                    <span>Recorded attempts</span>
                    <strong>{props.attempts.length}</strong>
                    <p>Practice and assessment responses</p>
                </div>
                <div>
                    <span>Independent accuracy</span>
                    <strong>{accuracy() === undefined ? "—" : `${accuracy()}%`}</strong>
                    <p>{independent().length} answers without a hint</p>
                </div>
                <div>
                    <span>Ready for review</span>
                    <strong>{due().length}</strong>
                    <p>Skills with a review due today</p>
                </div>
            </div>
            <div class="section-header">
                <div>
                    <h2>Skill estimates</h2>
                </div>
                <button class="button primary" onClick={() => props.onPractice()}>
                    Continue practicing <Icon name="arrow" size={17} />
                </button>
            </div>
            <div class="mastery-chart">
                <For each={skills}>
                    {(skill) => {
                        const state = () => props.states.find((s) => s.skill === skill.id);
                        return (
                            <div class="mastery-row">
                                <div>
                                    <h3>{skill.name}</h3>
                                    <p>{skill.description}</p>
                                </div>
                                <div
                                    class="mastery-track"
                                    role="meter"
                                    aria-label={`${skill.name} estimated mastery`}
                                    aria-valuemin="0"
                                    aria-valuemax="100"
                                    aria-valuenow={state() ? Math.round(state()!.mastery * 100) : 0}
                                >
                                    <svg
                                        viewBox="0 0 100 5"
                                        preserveAspectRatio="none"
                                        aria-hidden="true"
                                    >
                                        <rect
                                            width="100"
                                            height="5"
                                            fill="currentColor"
                                            opacity="0.07"
                                        />
                                        <rect
                                            width={state() ? state()!.mastery * 100 : 0}
                                            height="5"
                                            fill="#174ae8"
                                        />
                                    </svg>
                                </div>
                                <span class="mastery-value">
                                    {state()
                                        ? `${Math.round(state()!.mastery * 100)}%`
                                        : "No evidence yet"}
                                </span>
                                <div class="mastery-review">
                                    <span>
                                        {state()
                                            ? `${state()!.attempts} attempts · Review ${new Date(state()!.due).toLocaleDateString()}`
                                            : "Start with a first attempt"}
                                    </span>
                                    <button
                                        class="text-button"
                                        onClick={() => props.onPractice(skill.id)}
                                    >
                                        Practice <Icon name="arrow" size={15} />
                                    </button>
                                </div>
                            </div>
                        );
                    }}
                </For>
            </div>
            <p class="model-note">
                Mastery is a Bayesian Knowledge Tracing estimate, not a measured fact. The initial
                prior is 20%; learning, slip, and guess parameters are provisional. Hinted success
                does not count as independent accuracy.
            </p>
            <WritingGoalMap onPractice={props.onPractice} />
            <div class="section-header">
                <h2>Recent attempts</h2>
                <div class="button-row">
                    <button class="button secondary" onClick={props.onBackup}>
                        <Icon name="download" size={16} />
                        Export backup
                    </button>
                    <button class="text-button" onClick={props.onRestore}>
                        Restore backup
                    </button>
                </div>
            </div>
            <Show
                when={props.attempts.length}
                fallback={
                    <div class="empty-history">
                        <p>Your first attempt will appear here. Progress starts with a question.</p>
                    </div>
                }
            >
                <div class="attempt-list">
                    <For each={props.attempts.slice(-12).reverse()}>
                        {(a) => (
                            <div>
                                <span classList={{ "attempt-mark": true, wrong: !a.correct }}>
                                    {a.correct ? "✓" : "↗"}
                                </span>
                                <span>
                                    {skills.find((s) => s.id === a.skill)?.name}
                                    <small>
                                        {a.correct ? "Correct" : "Keep exploring"}
                                        {a.hints > 0
                                            ? ` · ${a.hints} hints`
                                            : " · Independent answer"}
                                    </small>
                                </span>
                                <time datetime={a.at}>{new Date(a.at).toLocaleString()}</time>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </section>
    );
}
