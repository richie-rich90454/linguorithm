import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AnalysisReport, SkillId } from "@grammar/engine";
import { Icon } from "./icons";

export function Workbench(props: {
    report?: AnalysisReport;
    stale: boolean;
    onAnalyze: () => void;
    onPractice: (skill?: SkillId) => void;
}) {
    const [index, setIndex] = createSignal(0);
    const [alternative, setAlternative] = createSignal(0);
    const sentence = createMemo(() => props.report?.sentences[index()]);
    createEffect(() => {
        if (index() >= (props.report?.sentences.length ?? 0)) setIndex(0);
    });
    const graph = createMemo(
        () => sentence()?.alternatives?.[alternative()]?.graph ?? sentence()?.graph ?? [],
    );
    const edges = createMemo(
        () =>
            graph().filter((e) =>
                [
                    "nsubj",
                    "nsubj:pass",
                    "obj",
                    "iobj",
                    "prep",
                    "case",
                    "det",
                    "amod",
                    "advcl",
                    "acl",
                    "conj",
                ].includes(e.relation),
            ) ?? [],
    );
    const related = createMemo(
        () =>
            props.report?.diagnostics.filter(
                (d) => sentence() && d.start >= sentence()!.start && d.end <= sentence()!.end,
            ) ?? [],
    );
    return (
        <section class="workbench">
            <div class="workbench-intro">
                <div>
                    <span class="status-tag">
                        {props.report?.modelStatus?.state === "ready"
                            ? "Trained local syntax"
                            : "Provisional syntax"}
                    </span>
                    <p>
                        {props.report?.modelStatus?.state === "ready"
                            ? "Compare proposed relationships and alternative parses. Review ambiguous structures in context."
                            : "Lexical fallback is active. Review proposed relationships in context."}
                    </p>
                </div>
                <button class="button secondary" onClick={() => props.onPractice("sentence")}>
                    Practice the structure <Icon name="arrow" size={16} />
                </button>
            </div>
            <Show when={props.stale}>
                <div class="notice">
                    The essay has changed.{" "}
                    <button onClick={props.onAnalyze}>Analyze the current revision</button> before
                    exploring its structure.
                </div>
            </Show>
            <Show
                when={props.report?.sentences.length}
                fallback={
                    <div class="empty-state">
                        <h2>No sentences to explore yet.</h2>
                        <p>Write and analyze an essay in the laboratory first.</p>
                    </div>
                }
            >
                <div class="sentence-controls">
                    <label for="sentence-select">Explore a sentence</label>
                    <select
                        id="sentence-select"
                        value={index()}
                        onChange={(e) => {
                            setIndex(Number(e.currentTarget.value));
                            setAlternative(0);
                        }}
                    >
                        <For each={props.report?.sentences}>
                            {(s, i) => (
                                <option value={i()}>
                                    {i() + 1}. {s.text.slice(0, 95)}
                                </option>
                            )}
                        </For>
                    </select>
                    <span>
                        {index() + 1} / {props.report?.sentences.length}
                    </span>
                </div>
                <Show when={sentence()}>
                    {(s) => (
                        <>
                            <Show when={(s().alternatives?.length ?? 0) > 1}>
                                <div class="parse-controls">
                                    <label for="parse-select">Compare syntactic alternatives</label>
                                    <select
                                        id="parse-select"
                                        value={alternative()}
                                        onChange={(e) =>
                                            setAlternative(Number(e.currentTarget.value))
                                        }
                                    >
                                        <For each={s().alternatives}>
                                            {(a, i) => (
                                                <option value={i()}>
                                                    Parse {i() + 1} · relative beam score{" "}
                                                    {a.score.toFixed(2)} (uncalibrated)
                                                </option>
                                            )}
                                        </For>
                                    </select>
                                </div>
                            </Show>
                            <details class="question-source">
                                <summary>Clause boundaries and modifier attachments</summary>
                                <For
                                    each={graph().filter((e) =>
                                        [
                                            "advcl",
                                            "acl",
                                            "ccomp",
                                            "xcomp",
                                            "conj",
                                            "parataxis",
                                            "amod",
                                            "advmod",
                                            "nmod",
                                            "obl",
                                        ].includes(e.relation),
                                    )}
                                >
                                    {(e) => (
                                        <p>
                                            <strong>{e.relation}</strong> ·{" "}
                                            {s().tokens[e.dependent]?.text} →{" "}
                                            {s().tokens[e.head]?.text}
                                        </p>
                                    )}
                                </For>
                                <p>
                                    Relationships are model hypotheses. A score orders alternatives
                                    and is not a probability of correctness.
                                </p>
                            </details>
                            <div class="sentence-quote">
                                <h2>{s().text}</h2>
                                <p>
                                    {s().ambiguous
                                        ? "Ambiguous structure · the fallback may not identify a reliable subject."
                                        : s().syntaxSource === "neural"
                                          ? "Neural syntax · review the suggested relationships."
                                          : "Lexical analysis · review the suggested relationships."}
                                </p>
                            </div>
                            <div class="diagram-scroll">
                                <svg
                                    class="dependency-diagram"
                                    width={Math.max(600, s().tokens.length * 95)}
                                    height="235"
                                    viewBox={`0 0 ${Math.max(600, s().tokens.length * 95)} 235`}
                                    role="img"
                                    aria-label={`Provisional dependency relationships for: ${s().text}`}
                                >
                                    <title>Proposed syntactic structure</title>
                                    <defs>
                                        <marker
                                            id="arrowhead"
                                            markerWidth="6"
                                            markerHeight="6"
                                            refX="5"
                                            refY="3"
                                            orient="auto"
                                        >
                                            <path d="M0 0L6 3L0 6" fill="#174ae8" />
                                        </marker>
                                    </defs>
                                    <For each={edges()}>
                                        {(edge, i) => {
                                            const x1 = edge.head * 95 + 48,
                                                x2 = edge.dependent * 95 + 48,
                                                y =
                                                    92 -
                                                    Math.min(
                                                        68,
                                                        Math.abs(x1 - x2) * 0.14 + i() * 3,
                                                    );
                                            return (
                                                <g>
                                                    <path
                                                        d={`M${x1} 140 C${x1} ${y},${x2} ${y},${x2} 134`}
                                                        fill="none"
                                                        stroke="#174ae8"
                                                        stroke-width="1.3"
                                                        marker-end="url(#arrowhead)"
                                                    />
                                                    <text
                                                        x={(x1 + x2) / 2}
                                                        y={y + 24}
                                                        text-anchor="middle"
                                                        class="dependency-label"
                                                    >
                                                        {edge.relation === "nsubj"
                                                            ? "subject"
                                                            : edge.relation === "obj"
                                                              ? "object"
                                                              : edge.relation === "prep"
                                                                ? "preposition"
                                                                : ((
                                                                      {
                                                                          det: "determiner",
                                                                          amod: "adjective modifier",
                                                                          advmod: "adverb modifier",
                                                                          case: "case marker",
                                                                          advcl: "adverbial clause",
                                                                          acl: "noun clause modifier",
                                                                          conj: "coordination",
                                                                          iobj: "indirect object",
                                                                          "nsubj:pass":
                                                                              "passive subject",
                                                                      } as Record<string, string>
                                                                  )[edge.relation] ??
                                                                  edge.relation)}
                                                    </text>
                                                </g>
                                            );
                                        }}
                                    </For>
                                    <For each={s().tokens}>
                                        {(token, i) => (
                                            <g>
                                                <text
                                                    x={i() * 95 + 48}
                                                    y="170"
                                                    text-anchor="middle"
                                                    classList={{
                                                        "diagram-token": true,
                                                        "diagram-verb":
                                                            token.pos === "VERB" ||
                                                            token.pos === "AUX",
                                                    }}
                                                >
                                                    {token.text}
                                                </text>
                                                <text
                                                    x={i() * 95 + 48}
                                                    y="196"
                                                    text-anchor="middle"
                                                    class="diagram-pos"
                                                >
                                                    {token.pos.toLowerCase()}
                                                </text>
                                            </g>
                                        )}
                                    </For>
                                </svg>
                            </div>
                            <div class="structure-key">
                                <span>
                                    <i class="key-line" />
                                    Proposed dependency
                                </span>
                                <span>
                                    <b>verb</b> Finite verb or auxiliary
                                </span>
                                <span>
                                    Source offsets {s().start}–{s().end} · UTF-16
                                </span>
                            </div>
                            <div class="token-table-wrap">
                                <h3>Look at the parts</h3>
                                <table class="token-table">
                                    <thead>
                                        <tr>
                                            <th>Word</th>
                                            <th>Provisional role</th>
                                            <th>Lemma candidates</th>
                                            <th>Source span</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <For each={s().tokens}>
                                            {(t) => (
                                                <tr>
                                                    <td>{t.text}</td>
                                                    <td>{t.pos.toLowerCase()}</td>
                                                    <td>
                                                        {[
                                                            ...new Set(
                                                                t.analyses.map((a) => a.lemma),
                                                            ),
                                                        ].join(", ")}
                                                    </td>
                                                    <td>
                                                        {t.start}–{t.end}
                                                    </td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </div>
                            <Show when={related().length}>
                                <div class="comparison">
                                    <h3>What changes, and why</h3>
                                    <For each={related()}>
                                        {(d) => (
                                            <div>
                                                <p>{d.explanation}</p>
                                                <Show when={d.proposals[0]}>
                                                    {(p) => (
                                                        <p class="comparison-text">
                                                            <del>{s().text}</del>
                                                            <span>→</span>
                                                            <ins>
                                                                {(() => {
                                                                    const e = p().edits[0]!;
                                                                    return (
                                                                        s().text.slice(
                                                                            0,
                                                                            e.start - s().start,
                                                                        ) +
                                                                        e.replacement +
                                                                        s().text.slice(
                                                                            e.end - s().start,
                                                                        )
                                                                    );
                                                                })()}
                                                            </ins>
                                                        </p>
                                                    )}
                                                </Show>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
        </section>
    );
}
