const LABELS = {
    1: "error",
    2: "not an error",
    3: "different correction",
    4: "valid dialect/register",
    0: "skip",
};
const elements = {
    loadPanel: document.querySelector("#load-panel"),
    dropzone: document.querySelector("#dropzone"),
    file: document.querySelector("#pool-file"),
    loadStatus: document.querySelector("#load-status"),
    workspace: document.querySelector("#workspace"),
    progress: document.querySelector("#progress"),
    progressText: document.querySelector("#progress-text"),
    labelCounts: document.querySelector("#label-counts"),
    position: document.querySelector("#item-position"),
    kind: document.querySelector("#item-kind"),
    doc: document.querySelector("#item-doc"),
    span: document.querySelector("#item-span"),
    sentence: document.querySelector("#item-sentence"),
    details: document.querySelector("#finding-details"),
    rule: document.querySelector("#item-rule"),
    category: document.querySelector("#item-category"),
    certainty: document.querySelector("#item-certainty"),
    proposals: document.querySelector("#proposals"),
    form: document.querySelector("#annotation-form"),
    labelButtons: [...document.querySelectorAll("[data-label]")],
    categoryInput: document.querySelector("#category"),
    corrections: document.querySelector("#corrections"),
    note: document.querySelector("#note"),
    annotator: document.querySelector("#annotator"),
    prev: document.querySelector("#prev"),
    next: document.querySelector("#next"),
    undo: document.querySelector("#undo"),
    save: document.querySelector("#save"),
    export: document.querySelector("#export"),
    status: document.querySelector("#status"),
};

const state = {
    pool: null,
    items: [],
    index: 0,
    annotations: new Map(),
    drafts: new Map(),
    history: [],
    saveTimer: 0,
};

function storageKey(format) {
    return `linguorithm:annotations:${format}`;
}

function setStatus(message) {
    elements.status.textContent = message;
}

function setLoadStatus(message) {
    elements.loadStatus.textContent = message;
}

function parseCorrections(value) {
    return [
        ...new Set(
            value
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean),
        ),
    ];
}

function currentItem() {
    return state.items[state.index];
}

function currentRecord() {
    const item = currentItem();
    if (!item) return null;
    return state.annotations.get(item.id) ?? state.drafts.get(item.id) ?? null;
}

function persist() {
    if (!state.pool) return;
    const payload = {
        poolFormat: state.pool.format,
        annotator: elements.annotator.value.trim(),
        annotations: Object.fromEntries(state.annotations),
    };
    localStorage.setItem(storageKey(state.pool.format), JSON.stringify(payload));
    setStatus("Saved locally");
}

function schedulePersist() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(persist, 250);
}

function pushHistory() {
    state.history.push({
        index: state.index,
        annotations: new Map(state.annotations),
    });
    if (state.history.length > 100) state.history.shift();
}

function restorePool(saved) {
    state.annotations = new Map();
    for (const [id, record] of Object.entries(saved.annotations ?? {})) {
        if (record && typeof record === "object" && typeof record.label === "number")
            state.annotations.set(id, record);
    }
    state.drafts = new Map();
    state.history = [];
    elements.annotator.value = typeof saved.annotator === "string" ? saved.annotator : "";
}

function renderSentence(item) {
    elements.sentence.textContent = "";
    const text = item.sentence;
    const start = Math.max(0, Math.min(text.length, item.span.start));
    const end = Math.max(start, Math.min(text.length, item.span.end));
    const mark = document.createElement("mark");
    if (end === start) mark.className = "insertion";
    mark.textContent = text.slice(start, end);
    elements.sentence.append(
        document.createTextNode(text.slice(0, start)),
        mark,
        document.createTextNode(text.slice(end)),
    );
    mark.title = "Target span";
}

function renderProposals(item) {
    elements.proposals.textContent = "";
    const proposals = Array.isArray(item.proposals) ? item.proposals.slice(0, 3) : [];
    if (!proposals.length) {
        const empty = document.createElement("li");
        empty.className = "muted";
        empty.textContent = "No correction proposals.";
        elements.proposals.append(empty);
        return;
    }
    for (const proposal of proposals) {
        const entry = document.createElement("li");
        const label = document.createElement("strong");
        label.textContent = proposal.label ?? "Proposal";
        const replacement = document.createElement("div");
        replacement.className = "replacement";
        replacement.textContent = proposal.replacement ?? "";
        entry.append(label, replacement);
        elements.proposals.append(entry);
    }
}

function renderProgress() {
    const total = state.items.length;
    const labeled = state.items.filter((item) => state.annotations.has(item.id)).length;
    elements.progress.max = Math.max(1, total);
    elements.progress.value = labeled;
    elements.progressText.textContent = `${labeled} / ${total} labeled`;
    const counts = {};
    for (const record of state.annotations.values())
        counts[record.label] = (counts[record.label] ?? 0) + 1;
    elements.labelCounts.textContent = Object.entries(LABELS)
        .map(([value, name]) => `${name}: ${counts[value] ?? 0}`)
        .join(" · ");
}

function render() {
    const item = currentItem();
    if (!item) {
        elements.workspace.hidden = true;
        elements.loadPanel.hidden = false;
        return;
    }
    elements.loadPanel.hidden = true;
    elements.workspace.hidden = false;

    elements.position.textContent = `${state.index + 1} / ${state.items.length}`;
    elements.kind.textContent = item.kind;
    elements.doc.textContent = `Document ${item.documentId}`;
    elements.span.textContent = `Span ${item.span.start}-${item.span.end}`;
    renderSentence(item);

    const isFinding = item.kind === "finding";
    elements.details.hidden = !isFinding;
    if (isFinding) {
        elements.rule.textContent = item.ruleId ?? "";
        elements.category.textContent = item.category ?? "";
        elements.certainty.textContent = item.certainty ?? "";
        renderProposals(item);
    }

    const record = currentRecord();
    elements.categoryInput.value = record ? (record.category ?? "") : (item.category ?? "");
    elements.corrections.value = Array.isArray(record?.corrections)
        ? record.corrections.join(", ")
        : "";
    elements.note.value = record?.note ?? "";

    for (const button of elements.labelButtons) {
        const active = record?.label === Number(button.dataset.label);
        button.setAttribute("aria-pressed", String(active));
    }
    elements.prev.disabled = state.index === 0;
    elements.next.disabled = state.index === state.items.length - 1;
    elements.undo.disabled = state.history.length === 0;
    renderProgress();
}

function applyLabel(label) {
    const item = currentItem();
    if (!item) return;
    pushHistory();
    const record = {
        id: item.id,
        label,
        category:
            elements.categoryInput.value ||
            (item.kind === "finding" ? (item.category ?? null) : null),
        corrections: parseCorrections(elements.corrections.value),
        note: elements.note.value.trim(),
    };
    state.annotations.set(item.id, record);
    state.drafts.delete(item.id);
    persist();
    setStatus(`Recorded ${LABELS[label]}`);
    if (state.index < state.items.length - 1) state.index++;
    render();
}

function undo() {
    const entry = state.history.pop();
    if (!entry) return;
    state.annotations = entry.annotations;
    state.index = entry.index;
    persist();
    setStatus("Undid last label");
    render();
}

function navigate(delta) {
    const next = state.index + delta;
    if (next < 0 || next >= state.items.length) return;
    state.index = next;
    render();
}

function updateDraft() {
    const item = currentItem();
    if (!item) return;
    const fields = {
        id: item.id,
        category: elements.categoryInput.value || null,
        corrections: parseCorrections(elements.corrections.value),
        note: elements.note.value.trim(),
    };
    const existing = state.annotations.get(item.id);
    if (existing) {
        state.annotations.set(item.id, { ...existing, ...fields });
        schedulePersist();
    } else {
        state.drafts.set(item.id, fields);
    }
}

function exportAnnotations() {
    if (!state.pool) return;
    const annotator = elements.annotator.value.trim();
    const items = state.items
        .filter((item) => state.annotations.has(item.id))
        .map((item) => {
            const record = state.annotations.get(item.id);
            return {
                id: record.id,
                label: record.label,
                category: record.category ?? null,
                corrections: record.corrections ?? [],
                note: record.note ?? "",
            };
        });
    const payload = {
        format: "linguorithm-annotations-v1",
        poolFormat: state.pool.format,
        annotator,
        completedAt: new Date().toISOString(),
        items,
    };
    persist();
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const suffix = annotator
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    link.href = url;
    link.download = `annotations-${suffix || "annotator"}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${items.length} annotations`);
}

async function loadPool(file) {
    try {
        const text = await file.text();
        const pool = JSON.parse(text);
        if (!pool || typeof pool.format !== "string" || !Array.isArray(pool.items))
            throw new Error("Not an annotation pool");
        state.pool = pool;
        state.items = pool.items;
        state.index = 0;
        const saved = localStorage.getItem(storageKey(pool.format));
        if (saved) {
            try {
                restorePool(JSON.parse(saved));
            } catch {
                restorePool({});
            }
        } else {
            restorePool({});
        }
        const firstUnlabeled = state.items.findIndex((item) => !state.annotations.has(item.id));
        state.index = firstUnlabeled === -1 ? 0 : firstUnlabeled;
        setLoadStatus(`Loaded ${state.items.length} items from ${file.name}.`);
        setStatus("");
        render();
        elements.annotator.focus();
    } catch (error) {
        setLoadStatus(`Could not load pool: ${error.message}`);
    }
}

elements.file.addEventListener("change", () => {
    const file = elements.file.files?.[0];
    if (file) loadPool(file);
});

elements.dropzone.addEventListener("click", (event) => {
    if (event.target !== elements.file) elements.file.click();
});
elements.dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.file.click();
    }
});
for (const name of ["dragenter", "dragover"]) {
    elements.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        elements.dropzone.classList.add("dragging");
    });
}
for (const name of ["dragleave", "drop"]) {
    elements.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        elements.dropzone.classList.remove("dragging");
    });
}
elements.dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) loadPool(file);
});

elements.labelButtons.forEach((button) => {
    button.addEventListener("click", () => applyLabel(Number(button.dataset.label)));
});
elements.prev.addEventListener("click", () => navigate(-1));
elements.next.addEventListener("click", () => navigate(1));
elements.undo.addEventListener("click", undo);
elements.save.addEventListener("click", persist);
elements.export.addEventListener("click", exportAnnotations);
elements.annotator.addEventListener("change", persist);
for (const input of [elements.categoryInput, elements.corrections, elements.note])
    input.addEventListener("input", updateDraft);

document.addEventListener("keydown", (event) => {
    if (!state.pool || elements.workspace.hidden) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing) {
        event.preventDefault();
        undo();
        return;
    }
    if (typing) return;
    if (Object.hasOwn(LABELS, event.key)) {
        event.preventDefault();
        applyLabel(Number(event.key));
        return;
    }
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(-1);
    } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigate(1);
    } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        persist();
    }
});
