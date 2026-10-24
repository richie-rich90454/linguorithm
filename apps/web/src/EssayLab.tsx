import { For, Show, createMemo, createSignal } from "solid-js";
import type {
    AnalysisReport,
    Diagnostic,
    EssayDocument,
    SkillId,
    WritingIntent,
} from "@grammar/engine";
import { Icon } from "./icons";

const intentPrompts: Record<WritingIntent, readonly string[]> = {
    general: [
        "What should your reader take away?",
        "Where could a concrete example make your meaning clearer?",
    ],
    narrative: [
        "What changes between the beginning and the end?",
        "Which moment would benefit from a specific detail?",
    ],
    descriptive: [
        "Which details help your reader picture the scene?",
        "Do your details create the impression you intended?",
    ],
    explanatory: [
        "Have you introduced each idea before building on it?",
        "Would an example make a difficult step easier to follow?",
    ],
    argumentative: [
        "Does each reason support your central claim?",
        "Have you addressed a thoughtful reader’s strongest objection?",
    ],
    reflective: [
        "What did the experience change in your thinking?",
        "Which detail helps explain why that change matters?",
    ],
    informative: [
        "What does your reader need to know first?",
        "Can your reader distinguish facts from your interpretation?",
    ],
    analytical: [
        "What does your evidence reveal beyond a summary?",
        "Have you explained how each example supports your interpretation?",
    ],
    creative: [
        "What feeling or effect do you want to create?",
        "Which language choices strengthen your intended voice?",
    ],
    "professional-communication": [
        "Is the purpose clear in the opening?",
        "Does your reader know the next step and who should take it?",
    ],
};

interface Props {
    doc?: EssayDocument;
    draft: string;
    report?: AnalysisReport;
    diagnostics: readonly Diagnostic[];
    active?: Diagnostic;
    stale: boolean;
    busy: boolean;
    editing: boolean;
    style: boolean;
    reviewMode: boolean;
    documents: readonly EssayDocument[];
    status: string;
    writingIntent?: WritingIntent;
    onIntent?: (intent: WritingIntent) => void;
    onEdit: (value: boolean) => void;
    onText: (text: string) => void;
    onAnalyze: () => void;
    onCancel: () => void;
    onSelect: (id: string) => void;
    onApply: (d: Diagnostic, index?: number) => void;
    onIgnore: (d: Diagnostic) => void;
    onHistory: (direction: "undo" | "redo") => void;
    onStyle: (value: boolean) => void;
    onReviewMode: (value: boolean) => void;
    onOpen: (doc: EssayDocument) => void;
    onNew: () => void;
    onTitle: (title: string) => void;
    onExport: () => void;
    onPractice: (skill?: SkillId) => void;
}
export function EssayLab(props: Props) {
    const [filter, setFilter] = createSignal("All findings");
    const filtered = createMemo(() =>
        props.diagnostics.filter((d) => filter() === "All findings" || d.category === filter()),
    );
    const active = createMemo(
        () => filtered().find((d) => d.id === props.active?.id) ?? filtered()[0],
    );
    const words = createMemo(
        () => props.draft.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0,
    );
    const segments = createMemo(() => {
        const text = props.draft;
        if (props.stale)
            return [
                { text, start: 0, diagnostics: [] as Diagnostic[], insertions: [] as Diagnostic[] },
            ];
        const boundaries = [
            ...new Set([0, text.length, ...props.diagnostics.flatMap((d) => [d.start, d.end])]),
        ].sort((a, b) => a - b);
        return boundaries.slice(0, -1).map((start, i) => {
            const end = boundaries[i + 1]!;
            return {
                text: text.slice(start, end),
                start,
                diagnostics: props.diagnostics.filter((d) => d.start < end && d.end > start),
                insertions: props.diagnostics.filter((d) => d.start === start && d.end === start),
            };
        });
    });
    const select = (d: Diagnostic) => {
        if (filter() !== "All findings" && filter() !== d.category) setFilter("All findings");
        props.onSelect(d.id);
        document.getElementById(`finding-${d.id}`)?.scrollIntoView({
            block: "nearest",
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
    };
    const showPassage = (d: Diagnostic) => {
        props.onSelect(d.id);
        props.onEdit(false);
        queueMicrotask(() => {
            document.getElementById(`annotation-${d.id}`)?.scrollIntoView({
                block: "center",
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth",
            });
            document.getElementById(`finding-${d.id}`)?.scrollIntoView({ block: "nearest" });
        });
    };
    const activeIndex = createMemo(() => filtered().findIndex((d) => d.id === active()?.id));
    return (
        <>
            <div class="lab-toolbar">
                <div class="document-picker">
                    <Icon name="essay" size={17} />
                    <select
                        aria-label="Current document"
                        value={props.doc?.record.id ?? ""}
                        onChange={(e) => {
                            const d = props.documents.find(
                                (d) => d.record.id === e.currentTarget.value,
                            );
                            if (d) props.onOpen(d);
                        }}
                    >
                        <For each={props.documents}>
                            {(d) => <option value={d.record.id}>{d.record.title}</option>}
                        </For>
                    </select>
                    <button class="icon-button" onClick={props.onNew} aria-label="New essay">
                        <Icon name="plus" size={17} />
                    </button>
                </div>
                <div class="toolbar-actions">
                    <button
                        class="icon-button"
                        aria-label="Undo change"
                        disabled={
                            !props.doc ||
                            (props.doc.record.cursor === 0 && props.doc.text === props.draft)
                        }
                        onClick={() => props.onHistory("undo")}
                    >
                        <Icon name="undo" size={17} />
                    </button>
                    <button
                        class="icon-button"
                        aria-label="Redo change"
                        disabled={
                            !props.doc ||
                            props.doc.record.cursor === props.doc.record.revisions.length - 1
                        }
                        onClick={() => props.onHistory("redo")}
                    >
                        <Icon name="redo" size={17} />
                    </button>
                    <span class="toolbar-divider" />
                    <button
                        class="text-button export-button"
                        onClick={props.onExport}
                        aria-label="Export text"
                        disabled={!props.draft.trim()}
                    >
                        <Icon name="download" size={16} />
                        Export text
                    </button>
                </div>
            </div>
            <div class="lab-grid">
                <section class="essay-surface" aria-label="Essay document">
                    <div class="essay-meta">
                        <span>
                            <span class="document-dot" />
                            Your writing
                        </span>
                        <button class="text-button" onClick={() => props.onEdit(!props.editing)}>
                            {props.editing ? "Reading view" : "Edit text"}
                            <span>↗</span>
                        </button>
                    </div>
                    <input
                        class="essay-title"
                        aria-label="Essay title"
                        value={props.doc?.record.title ?? ""}
                        onChange={(e) => props.onTitle(e.currentTarget.value)}
                    />
                    <div class="writing-intent">
                        <label for="writing-intent">Writing intent</label>
                        <select
                            id="writing-intent"
                            disabled={!props.doc}
                            value={props.writingIntent ?? "general"}
                            onChange={(e) =>
                                props.onIntent?.(e.currentTarget.value as WritingIntent)
                            }
                            aria-describedby="writing-intent-help"
                        >
                            <option value="general">Everyday writing</option>
                            <option value="narrative">Tell a story</option>
                            <option value="descriptive">Describe a scene</option>
                            <option value="informative">Share information</option>
                            <option value="explanatory">Explain an idea</option>
                            <option value="argumentative">Make an argument</option>
                            <option value="reflective">Reflect on an experience</option>
                            <option value="analytical">Analyze a text or idea</option>
                            <option value="creative">Explore creatively</option>
                            <option value="professional-communication">
                                Communicate professionally
                            </option>
                        </select>
                        <p id="writing-intent-help">
                            Choose the context for this draft. You decide which suggestions fit your
                            voice.
                        </p>
                        <details class="intent-guidance">
                            <summary>Optional writing guidance</summary>
                            <p>
                                Reflection prompts for your intent, separate from detected findings.
                            </p>
                            <ul>
                                <For each={intentPrompts[props.writingIntent ?? "general"]}>
                                    {(prompt) => <li>{prompt}</li>}
                                </For>
                            </ul>
                        </details>
                    </div>
                    <p class="essay-instruction">
                        {props.editing
                            ? "Make your changes, then analyze to see fresh findings."
                            : props.stale || !props.report
                              ? "Analyze your writing to see suggestions in context."
                              : "Select an underlined passage to review its finding."}
                    </p>
                    <Show
                        when={props.editing}
                        fallback={
                            <div class="essay-text" aria-label="Annotated essay">
                                <Show
                                    when={props.draft.trim()}
                                    fallback={
                                        <button
                                            class="empty-editor"
                                            onClick={() => props.onEdit(true)}
                                        >
                                            Start writing or paste your essay here…
                                        </button>
                                    }
                                >
                                    <For each={segments()}>
                                        {(part) => (
                                            <>
                                                <For each={part.insertions}>
                                                    {(d) => (
                                                        <button
                                                            class="insertion-marker"
                                                            id={`annotation-${d.id}`}
                                                            onClick={() => select(d)}
                                                            aria-label={d.title}
                                                        >
                                                            ⌄
                                                        </button>
                                                    )}
                                                </For>
                                                <Show
                                                    when={part.diagnostics[0]}
                                                    fallback={part.text}
                                                >
                                                    {(d) => (
                                                        <button
                                                            classList={{
                                                                annotation: true,
                                                                "annotation-active":
                                                                    part.diagnostics.some(
                                                                        (item) =>
                                                                            item.id ===
                                                                            active()?.id,
                                                                    ),
                                                                "annotation-blue":
                                                                    d().category === "Style" ||
                                                                    d().certainty ===
                                                                        "Possible issue",
                                                            }}
                                                            id={
                                                                d().start === part.start
                                                                    ? `annotation-${d().id}`
                                                                    : undefined
                                                            }
                                                            onClick={() => select(d())}
                                                            aria-label={`${part.text}: ${d().title}`}
                                                        >
                                                            {part.text}
                                                        </button>
                                                    )}
                                                </Show>
                                            </>
                                        )}
                                    </For>
                                </Show>
                            </div>
                        }
                    >
                        <textarea
                            class="essay-editor"
                            aria-label="Essay text"
                            value={props.draft}
                            maxlength={150_000}
                            spellcheck={false}
                            onInput={(e) => props.onText(e.currentTarget.value)}
                            placeholder="Paste your essay here. Your writing stays on this device."
                        />
                    </Show>
                    <div class="essay-bottom">
                        <span>
                            {words()} words
                            <Show when={props.report && !props.stale}>
                                <span>·</span> {props.report?.sentences.length} sentences
                            </Show>
                            <span>·</span> American English
                        </span>
                        <Show
                            when={props.busy}
                            fallback={
                                <button
                                    class="button primary"
                                    onClick={props.onAnalyze}
                                    disabled={!props.draft.trim()}
                                >
                                    {props.stale || !props.report
                                        ? "Analyze essay"
                                        : "Analyze again"}
                                    <Icon name="arrow" size={17} />
                                </button>
                            }
                        >
                            <button class="button secondary" onClick={props.onCancel}>
                                <span class="spinner" />
                                Cancel analysis
                            </button>
                        </Show>
                    </div>
                </section>
                <aside class="findings-panel" aria-label="Analysis findings" aria-busy={props.busy}>
                    <div class="findings-heading">
                        <h2>
                            Findings{" "}
                            <Show when={props.report && !props.stale && !props.busy}>
                                <span>{props.diagnostics.length}</span>
                            </Show>
                        </h2>
                        <p role="status">
                            {props.busy
                                ? "Looking for grammatical relationships…"
                                : props.stale
                                  ? "Text changed. Analyze for current findings."
                                  : !props.report
                                    ? "Your feedback will appear here."
                                    : "Review each suggestion, then choose what to keep."}
                        </p>
                    </div>
                    <div class="finding-filters" role="group" aria-label="Filter findings">
                        <For
                            each={[
                                "All findings",
                                "Grammar",
                                "Punctuation",
                                "Spelling",
                                "Usage",
                                "Style",
                            ]}
                        >
                            {(category) => (
                                <button
                                    classList={{ selected: filter() === category }}
                                    aria-pressed={filter() === category}
                                    onClick={() => setFilter(category)}
                                >
                                    {category}
                                    {category === "All findings" ? (
                                        ""
                                    ) : (
                                        <span>
                                            {
                                                props.diagnostics.filter(
                                                    (d) => d.category === category,
                                                ).length
                                            }
                                        </span>
                                    )}
                                </button>
                            )}
                        </For>
                    </div>
                    <div class="analysis-options">
                        <label>
                            <input
                                type="checkbox"
                                checked={props.reviewMode}
                                onChange={(e) => props.onReviewMode(e.currentTarget.checked)}
                            />
                            Include possible issues
                        </label>
                        <label>
                            <input
                                type="checkbox"
                                checked={props.style}
                                onChange={(e) => props.onStyle(e.currentTarget.checked)}
                            />
                            Optional style observations
                        </label>
                    </div>
                    <Show
                        when={props.report && !props.stale && !props.busy}
                        fallback={
                            <div class="analysis-placeholder">
                                <Icon name={props.busy ? "structure" : "essay"} size={28} />
                                <h3>
                                    {props.busy
                                        ? "Tracing the relationships…"
                                        : !props.draft.trim()
                                          ? "Start with your draft."
                                          : !props.report
                                            ? "Ready when you are."
                                            : "Your draft has changed."}
                                </h3>
                                <p>
                                    {props.busy
                                        ? "Your essay is being analyzed locally in a background worker."
                                        : !props.draft.trim()
                                          ? "Write or paste your text, then choose Analyze essay. Your writing stays on this device."
                                          : "Choose Analyze essay to review your current text. Your writing stays on this device."}
                                </p>
                            </div>
                        }
                    >
                        <Show when={filtered().length > 1}>
                            <nav class="finding-navigation" aria-label="Navigate findings">
                                <span>
                                    {activeIndex() + 1} of {filtered().length}
                                </span>
                                <button
                                    class="text-button"
                                    disabled={activeIndex() <= 0}
                                    onClick={() => showPassage(filtered()[activeIndex() - 1]!)}
                                    aria-label="Previous finding"
                                >
                                    ← Previous
                                </button>
                                <button
                                    class="text-button"
                                    disabled={activeIndex() >= filtered().length - 1}
                                    onClick={() => showPassage(filtered()[activeIndex() + 1]!)}
                                    aria-label="Next finding"
                                >
                                    Next →
                                </button>
                            </nav>
                        </Show>
                        <div class="findings-list">
                            <Show
                                when={filtered().length}
                                fallback={
                                    <div class="analysis-placeholder">
                                        <Icon name="check" size={30} />
                                        <h3>
                                            {props.diagnostics.length
                                                ? "No findings in this category."
                                                : "No supported issues found."}
                                        </h3>
                                        <p>
                                            {props.diagnostics.length
                                                ? "Try All findings to continue reviewing your writing."
                                                : "Read through once more for meaning and flow. An unmarked passage is not a guarantee of correctness."}
                                        </p>
                                        <Show when={props.diagnostics.length}>
                                            <button
                                                class="button secondary"
                                                onClick={() => setFilter("All findings")}
                                            >
                                                Show all findings
                                            </button>
                                        </Show>
                                    </div>
                                }
                            >
                                <For each={filtered()}>
                                    {(d, index) => (
                                        <article
                                            id={`finding-${d.id}`}
                                            classList={{
                                                "finding-item": true,
                                                "finding-active": active()?.id === d.id,
                                            }}
                                        >
                                            <button
                                                class="finding-select"
                                                onClick={() => showPassage(d)}
                                                aria-expanded={active()?.id === d.id}
                                                aria-controls={`finding-detail-${d.id}`}
                                            >
                                                <span
                                                    classList={{
                                                        "finding-number": true,
                                                        "blue-number":
                                                            d.certainty === "Possible issue" ||
                                                            d.category === "Style",
                                                    }}
                                                >
                                                    {String(index() + 1).padStart(2, "0")}
                                                </span>
                                                <span>
                                                    <span class="finding-category">
                                                        {d.category} <span>·</span> {d.certainty}
                                                    </span>
                                                    <strong>{d.title}</strong>
                                                </span>
                                                <span class="finding-expand" aria-hidden="true">
                                                    {active()?.id === d.id ? "↗" : "+"}
                                                </span>
                                            </button>
                                            <Show when={active()?.id === d.id}>
                                                <div
                                                    class="finding-detail"
                                                    id={`finding-detail-${d.id}`}
                                                >
                                                    <div class="correction-preview">
                                                        <del>
                                                            {props.draft.slice(d.start, d.end) ||
                                                                "∅"}
                                                        </del>
                                                        <Show when={d.proposals[0]}>
                                                            {(p) => (
                                                                <>
                                                                    <span>→</span>
                                                                    <ins>
                                                                        {p().edits[0]
                                                                            ?.replacement ||
                                                                            "Remove"}
                                                                    </ins>
                                                                </>
                                                            )}
                                                        </Show>
                                                    </div>
                                                    <p>{d.explanation}</p>
                                                    <div class="evidence-label">
                                                        The relationship
                                                    </div>
                                                    <div class="evidence-list">
                                                        <For
                                                            each={d.evidence.filter(
                                                                (e, index, all) =>
                                                                    all.findIndex(
                                                                        (other) =>
                                                                            other.start ===
                                                                                e.start &&
                                                                            other.end === e.end,
                                                                    ) === index,
                                                            )}
                                                        >
                                                            {(e) => (
                                                                <span>
                                                                    <b>
                                                                        {props.draft.slice(
                                                                            e.start,
                                                                            e.end,
                                                                        ) || "Boundary"}
                                                                    </b>
                                                                    <small>{e.label}</small>
                                                                </span>
                                                            )}
                                                        </For>
                                                    </div>
                                                    <div class="finding-buttons">
                                                        <Show when={d.proposals.length}>
                                                            <button
                                                                class="button blue"
                                                                onClick={() => props.onApply(d)}
                                                            >
                                                                Apply correction{" "}
                                                                <Icon name="check" size={15} />
                                                            </button>
                                                        </Show>
                                                        <button
                                                            class="text-button"
                                                            title="Keep your wording and hide this finding"
                                                            aria-label={`Dismiss ${d.title}; keep your wording`}
                                                            onClick={() => props.onIgnore(d)}
                                                        >
                                                            Keep my wording
                                                        </button>
                                                    </div>
                                                    <Show when={d.proposals.length > 1}>
                                                        <For each={d.proposals.slice(1)}>
                                                            {(p, i) => (
                                                                <button
                                                                    class="text-button"
                                                                    onClick={() =>
                                                                        props.onApply(d, i() + 1)
                                                                    }
                                                                >
                                                                    {p.label}
                                                                </button>
                                                            )}
                                                        </For>
                                                    </Show>
                                                    <button
                                                        class="practice-link"
                                                        onClick={() => props.onPractice(d.skill)}
                                                    >
                                                        Understand it through practice{" "}
                                                        <Icon name="arrow" size={16} />
                                                    </button>
                                                    <p class="confidence-note">
                                                        {d.confidence.policy}
                                                    </p>
                                                </div>
                                            </Show>
                                        </article>
                                    )}
                                </For>
                            </Show>
                        </div>
                    </Show>
                    <div class="engine-note">
                        <Icon name="shield" size={17} />
                        <p>
                            <span data-testid="model-status">
                                {props.report?.modelStatus?.state === "ready"
                                    ? "Local neural syntax · ewt-1"
                                    : "Deterministic fallback"}
                            </span>
                            <br />
                            <span>
                                {props.report?.modelStatus?.state === "unavailable"
                                    ? props.report.modelStatus.detail
                                    : "No generative AI. Review in context."}
                            </span>
                        </p>
                    </div>
                </aside>
            </div>
            <div class="save-status" role="status">
                <span classList={{ "save-dot": true, pending: props.stale }} />
                {props.status}
                <Show when={props.report}>
                    <span class="analysis-timing">
                        {Math.round(props.report!.elapsedMs)} ms · {props.report!.cachedParagraphs}{" "}
                        cached paragraphs
                    </span>
                </Show>
            </div>
        </>
    );
}
