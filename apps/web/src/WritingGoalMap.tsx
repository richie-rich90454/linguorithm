import { For, createMemo, createSignal } from "solid-js";
import { writingGoals, type ProficiencyBand } from "../../../packages/engine/src/goals";
import type { SkillId } from "../../../packages/engine/src/domain";
import "./writing-goals.css";

const bands: readonly { id: ProficiencyBand; label: string }[] = [
    { id: "emergent", label: "Emergent writing" },
    { id: "developing", label: "Developing" },
    { id: "foundational", label: "Foundational" },
    { id: "intermediate", label: "Intermediate" },
    { id: "advanced", label: "Advanced" },
];

const detectorStatus: Readonly<Record<(typeof writingGoals)[number]["detection"], string>> = {
    "implemented-unvalidated": "Some rule coverage · quality gates unverified",
    "not-yet-detectable": "Writing goal · no automated detector yet",
};

export function WritingGoalMap(props: { onPractice: (skill?: SkillId) => void }) {
    const [selectedBand, setSelectedBand] = createSignal<ProficiencyBand | "all">("all");
    const visible = createMemo(() =>
        writingGoals.filter((goal) => selectedBand() === "all" || goal.band === selectedBand()),
    );

    return (
        <details class="question-source writing-goal-map">
            <summary>Explore writing goals</summary>
            <p>
                Browse general writing goals from emergent text to advanced writing. Detector labels
                describe current coverage; they are not mastery scores or quality certifications.
            </p>
            <label class="goal-stage-picker">
                Writing stage
                <select
                    value={selectedBand()}
                    onChange={(event) =>
                        setSelectedBand(event.currentTarget.value as ProficiencyBand | "all")
                    }
                >
                    <option value="all">All stages</option>
                    <For each={bands}>
                        {(band) => <option value={band.id}>{band.label}</option>}
                    </For>
                </select>
            </label>
            <div class="writing-goal-list" aria-live="polite">
                <For each={visible()}>
                    {(goal) => (
                        <article class="writing-goal-row">
                            <div class="writing-goal-copy">
                                <h3>{goal.name}</h3>
                                <p>{goal.description}</p>
                                <span class="writing-goal-status">
                                    {detectorStatus[goal.detection]}
                                </span>
                                <details class="writing-goal-details">
                                    <summary>Example and valid controls</summary>
                                    <p>
                                        <strong>Example:</strong> {goal.example}
                                    </p>
                                    <p>
                                        <strong>Progression:</strong> {goal.ageOrProficiency}
                                    </p>
                                    <ul>
                                        <For each={goal.validControls}>
                                            {(control) => <li>{control}</li>}
                                        </For>
                                    </ul>
                                    <p>{goal.correctionPolicy}</p>
                                </details>
                            </div>
                            <button
                                class="text-button"
                                disabled={!goal.skill}
                                onClick={() => props.onPractice(goal.skill)}
                            >
                                {goal.skill ? "Practice this skill" : "Practice not available"}
                            </button>
                        </article>
                    )}
                </For>
            </div>
        </details>
    );
}
