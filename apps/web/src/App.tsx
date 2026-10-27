import {
    For,
    Show,
    Suspense,
    createEffect,
    createMemo,
    createSignal,
    lazy,
    onCleanup,
    onMount,
} from "solid-js";
import { EssayDocument } from "../../../packages/engine/src/domain";
import type {
    AnalysisReport,
    Attempt,
    Diagnostic,
    Exercise,
    Material,
    SkillId,
    SkillState,
    Assessment,
    WritingIntent,
} from "../../../packages/engine/src/domain";
import {
    contributesToGrammarMastery,
    db,
    download,
    exportBackup,
    reconcileGrammarMastery,
    restoreBackup,
    saveDocument,
} from "./persistence";
import { extractFile } from "./import";
import { Icon } from "./icons";
import { EssayLab } from "./EssayLab";

const Workbench = lazy(() =>
    import("./Workbench").then((module) => ({ default: module.Workbench })),
);
const Practice = lazy(() => import("./Practice").then((module) => ({ default: module.Practice })));
const Progress = lazy(() => import("./Progress").then((module) => ({ default: module.Progress })));

const sample = `Good writing begins with careful observation. A collection of small details are often more revealing than a single grand idea. When we slow down, we begin to notice the relationships between things.

In our first experiment, we studied how students revise their essays. The students in the study were thoughtful and curious. However the results revealed something unexpected: knowing a rule is different from knowing when to use it.

She has wrote about this difference before. It is not enough to recieve a correction; a writer needs to understand the reason behind it. The the process of revision becomes more useful when each change leads to a question.

We can learn to see those patterns. We can make a correction, explain our reasoning, and try a new sentence. Over time, that practice helps us become more independent writers.`;
type Page = "Essay laboratory" | "Sentence workbench" | "Practice" | "Materials" | "Your progress";
const nav: {
    page: Page;
    icon: "essay" | "structure" | "practice" | "library" | "progress";
    index: string;
}[] = [
    { page: "Essay laboratory", icon: "essay", index: "01" },
    { page: "Sentence workbench", icon: "structure", index: "02" },
    { page: "Practice", icon: "practice", index: "03" },
    { page: "Materials", icon: "library", index: "04" },
    { page: "Your progress", icon: "progress", index: "05" },
];

export default function App() {
    const [page, setPage] = createSignal<Page>("Essay laboratory");
    const [practiceVisited, setPracticeVisited] = createSignal(false);
    const [doc, setDoc] = createSignal<EssayDocument>();
    const [draft, setDraft] = createSignal("");
    const [documents, setDocuments] = createSignal<EssayDocument[]>([]);
    const [report, setReport] = createSignal<AnalysisReport>();
    const [busy, setBusy] = createSignal(false);
    const [status, setStatus] = createSignal("Opening your local workspace…");
    const [storageFailed, setStorageFailed] = createSignal(false);
    const [error, setError] = createSignal("");
    const [style, setStyle] = createSignal(false);
    const [reviewMode, setReviewMode] = createSignal(false);
    const [selected, setSelected] = createSignal<string>();
    const [ignored, setIgnored] = createSignal<string[]>([]);
    const [editing, setEditing] = createSignal(false);
    const [states, setStates] = createSignal<SkillState[]>([]);
    const [attempts, setAttempts] = createSignal<Attempt[]>([]);
    const [materials, setMaterials] = createSignal<Material[]>([]);
    const [materialQuestions, setMaterialQuestions] = createSignal<Exercise[]>([]);
    const [question, setQuestion] = createSignal<Exercise>();
    const [quizQueue, setQuizQueue] = createSignal<Exercise[]>();
    const [practiceSkill, setPracticeSkill] = createSignal<SkillId>();
    const [settings, setSettings] = createSignal(false);
    const [modelsEnabled, setModelsEnabled] = createSignal(true);
    const [dictionary, setDictionary] = createSignal<string[]>([]);
    const [assessments, setAssessments] = createSignal<Assessment[]>([]);
    const [assessment, setAssessment] = createSignal<Assessment>();
    type FeatureEngine = typeof import("@grammar/engine");
    const [featureEngine, setFeatureEngine] = createSignal<FeatureEngine>();
    const [mutations, setMutations] = createSignal<Exercise[]>([]);
    const [offline, setOffline] = createSignal(!navigator.onLine);
    const [loadingFile, setLoadingFile] = createSignal(false);
    const materialStructures = createMemo(() => {
        const Extractor = featureEngine()?.MaterialExtractor;
        if (!Extractor) return [];
        const extractor = new Extractor();
        return materials().map((material) => ({
            material,
            extraction: extractor.analyze(material),
        }));
    });
    let worker: Worker | undefined;
    let request = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let latestDocumentSave: Promise<void> = Promise.resolve();
    let documentSaveSequence = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let featureEnginePromise: Promise<FeatureEngine> | undefined;
    const bank = createMemo(() => [
        ...(featureEngine()?.exerciseBank ?? []),
        ...mutations(),
        ...materialQuestions(),
    ]);
    const visible = createMemo(
        () =>
            report()?.diagnostics.filter(
                (d) =>
                    !ignored().includes(d.id) &&
                    (reviewMode() || d.certainty !== "Possible issue") &&
                    (style() || d.category !== "Style"),
            ) ?? [],
    );
    const activeDiagnostic = createMemo(
        () => visible().find((d) => d.id === selected()) ?? visible()[0],
    );
    const stale = createMemo(() => report()?.text !== draft());

    function fail(cause: unknown) {
        setError(
            cause instanceof Error ? cause.message : "Something went wrong. Please try again.",
        );
    }
    function loadFeatureEngine(): Promise<FeatureEngine> {
        if (!featureEnginePromise)
            featureEnginePromise = import("@grammar/engine")
                .then((services) => {
                    setFeatureEngine(services);
                    setMutations(services.buildMutationBank());
                    return services;
                })
                .catch((cause: unknown) => {
                    featureEnginePromise = undefined;
                    throw cause;
                });
        return featureEnginePromise;
    }
    async function refreshDocuments() {
        setDocuments(
            (await db.documents.toArray())
                .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
                .map((r) => new EssayDocument(r)),
        );
    }
    async function persist(document: EssayDocument) {
        const sequence = ++documentSaveSequence;
        setStatus("Saving on this device…");
        const save = latestDocumentSave
            .catch(() => undefined)
            .then(() => saveDocument(document.record));
        latestDocumentSave = save;
        try {
            await save;
            await refreshDocuments();
            if (sequence === documentSaveSequence) {
                setStorageFailed(false);
                setStatus("Saved on this device");
            }
        } catch (cause) {
            if (sequence === documentSaveSequence) {
                setStorageFailed(true);
                setStatus("Not saved · export text to keep your work");
            }
            throw cause instanceof Error
                ? cause
                : new Error(
                      "Browser storage could not save this document. Export the text to keep your work.",
                  );
        }
    }
    function startWorker() {
        worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (
            event: MessageEvent<{ id: number; report?: AnalysisReport; error?: string }>,
        ) => {
            if (event.data.id !== request) return;
            clearTimeout(timeout);
            setBusy(false);
            if (event.data.error) {
                setError(event.data.error);
                return;
            }
            setReport(event.data.report);
            const result = event.data.report,
                current = doc();
            if (result && current)
                safely(async () => {
                    await db.reports.put({
                        id: `${current.record.id}:${result.revision}`,
                        documentId: current.record.id,
                        revision: result.revision,
                        report: result,
                        at: new Date().toISOString(),
                    });
                    const old = await db.reports.orderBy("at").primaryKeys();
                    if (old.length > 20) await db.reports.bulkDelete(old.slice(0, old.length - 20));
                    if (result.modelStatus)
                        await db.models.put({
                            id: "local-syntax",
                            version: result.versions.syntax ?? "fallback",
                            status: result.modelStatus.state,
                            detail: result.modelStatus.detail,
                            at: new Date().toISOString(),
                        });
                });
            setIgnored([]);
            setSelected(undefined);
            const completedRequest = event.data.id;
            void latestDocumentSave.then(
                () => {
                    if (completedRequest === request)
                        setStatus(
                            storageFailed()
                                ? "Analysis complete · not saved; export text to keep your work"
                                : "Analysis complete · saved on this device",
                        );
                },
                () => {
                    if (completedRequest === request)
                        setStatus("Analysis complete · not saved; export text to keep your work");
                },
            );
        };
        worker.onerror = () => {
            clearTimeout(timeout);
            setBusy(false);
            setError("The analysis worker stopped. Try analyzing again.");
            worker?.terminate();
            worker = undefined;
        };
    }
    function cancel() {
        request++;
        worker?.terminate();
        worker = undefined;
        clearTimeout(timeout);
        setBusy(false);
        setStatus("Analysis cancelled");
    }
    function analyze(document = doc()) {
        if (!document) return;
        clearTimeout(saveTimer);
        const current =
            document.text === draft() ? document : document.revise(draft(), "Edited essay");
        setDoc(current);
        setEditing(false);
        setError("");
        void persist(current).catch(fail);
        if (!worker) startWorker();
        setBusy(true);
        const id = ++request;
        worker!.postMessage({
            id,
            text: current.text,
            revision: current.record.cursor,
            style: style(),
            writingIntent: current.record.writingIntent ?? "general",
            models: modelsEnabled(),
            personalDictionary: dictionary(),
            assetBase: new URL(import.meta.env.BASE_URL, globalThis.document.baseURI).href,
        });
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            cancel();
            setError("Analysis exceeded 20 seconds and was cancelled. Try a shorter document.");
        }, 20_000);
    }
    function changeWritingIntent(intent: WritingIntent) {
        const current = doc();
        if (!current) return;
        const updated = current.withWritingIntent(intent);
        if (updated === current) return;
        setDoc(updated);
        void persist(updated).catch(fail);
        analyze(updated);
    }
    function changeText(text: string) {
        setDraft(text);
        setStatus("Unsaved changes");
        clearTimeout(saveTimer);
        if (busy()) cancel();
        saveTimer = setTimeout(() => {
            const current = doc();
            if (current) {
                try {
                    const updated = current.revise(text, "Edited essay");
                    setDoc(updated);
                    void persist(updated).catch(fail);
                } catch (cause) {
                    fail(cause);
                }
            }
        }, 700);
    }
    function commitPending(): EssayDocument | undefined {
        clearTimeout(saveTimer);
        const current = doc();
        if (!current) return;
        const updated = current.revise(draft(), "Edited essay");
        setDoc(updated);
        return updated;
    }
    async function openDocument(document: EssayDocument) {
        const previous = commitPending();
        if (previous) await persist(previous);
        if (busy()) cancel();
        setDoc(document);
        setDraft(document.text);
        setReport(undefined);
        setEditing(false);
        analyze(document);
    }
    async function newDocument(text = "", title = "Untitled essay") {
        if ((await db.documents.count()) >= 100)
            throw new Error(
                "This workspace supports 100 documents. Export your work before moving to a new browser workspace.",
            );
        const previous = commitPending();
        if (previous) await persist(previous);
        const document = EssayDocument.create(text, title);
        if (busy()) cancel();
        setDoc(document);
        setDraft(text);
        setReport(undefined);
        setPage("Essay laboratory");
        setEditing(!text);
        await persist(document);
        if (text) analyze(document);
    }
    function apply(d: Diagnostic, proposalIndex = 0) {
        const proposal = d.proposals[proposalIndex];
        if (!proposal || stale()) return;
        try {
            const updated = doc()!.apply(proposal);
            setDoc(updated);
            setDraft(updated.text);
            analyze(updated);
        } catch (cause) {
            fail(cause);
        }
    }
    function history(direction: "undo" | "redo") {
        const current = commitPending();
        if (!current) return;
        const updated = current[direction]();
        setDoc(updated);
        setDraft(updated.text);
        analyze(updated);
    }
    async function importDocument(file: File, target: "essay" | "material") {
        setLoadingFile(true);
        setError("");
        try {
            const text = await extractFile(file);
            if (target === "essay") await newDocument(text, file.name.replace(/\.[^.]+$/u, ""));
            else {
                if ((await db.materials.count()) >= 100)
                    throw new Error(
                        "This workspace supports 100 source materials. Remove an unneeded material before importing another.",
                    );
                const material: Material = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    text,
                    format: file.name.split(".").at(-1) ?? "txt",
                    importedAt: new Date().toISOString(),
                };
                await db.transaction("rw", db.materials, async () => {
                    if ((await db.materials.count()) >= 100)
                        throw new Error(
                            "This workspace has reached its limit of 100 source materials.",
                        );
                    await db.materials.put(material);
                });
                setMaterials(await db.materials.toArray());
                const { QuizAssembler } = await loadFeatureEngine();
                const quiz = new QuizAssembler().fromMaterial(material);
                setMaterialQuestions(quiz.exercises);
                setQuestion(undefined);
                setStatus(
                    quiz.exercises.length
                        ? `${quiz.exercises.length} source-linked questions ready`
                        : quiz.limitations[0]!,
                );
            }
        } catch (cause) {
            fail(cause);
        } finally {
            setLoadingFile(false);
        }
    }
    async function nextQuestion(skill = practiceSkill()) {
        const services = await loadFeatureEngine();
        const active = assessment();
        if (active) {
            setQuestion(
                bank().find(
                    (q) =>
                        active.exerciseIds.includes(q.id) &&
                        !active.answers.some((a) => a.exerciseId === q.id),
                ),
            );
            return;
        }
        if (quizQueue() !== undefined) {
            const [next, ...remaining] = quizQueue()!;
            setQuizQueue(remaining);
            setQuestion(next);
            return;
        }
        const recent = attempts()
            .slice()
            .reverse()
            .map((a) => a.exerciseId)
            .slice(0, 10);
        if (question()) recent.unshift(question()!.id);
        const next = new services.ExerciseSelector().select(bank(), states(), recent, skill);
        setQuestion(next);
    }
    function startPractice(skill?: SkillId) {
        safely(async () => {
            await loadFeatureEngine();
            setAssessment(undefined);
            setQuizQueue(undefined);
            setPracticeSkill(skill);
            setPracticeVisited(true);
            setPage("Practice");
            setQuestion(undefined);
            await nextQuestion(skill);
        });
    }
    async function answer(
        q: Exercise,
        selectedAnswer: number | undefined,
        hints: number,
        durationMs = 0,
        responseText?: string,
        reviewRequired = false,
    ) {
        const services = await loadFeatureEngine();
        if ((await db.attempts.count()) >= 50_000)
            throw new Error(
                "This workspace has reached 50,000 recorded attempts. Export your learning records before starting a new workspace.",
            );
        const active = assessment();
        const updated = active
            ? new services.AssessmentService().answer(
                  active,
                  q,
                  selectedAnswer,
                  new Date(),
                  reviewRequired,
              )
            : undefined;
        const attempt: Attempt = {
            id: crypto.randomUUID(),
            exerciseId: q.id,
            skill: q.skill,
            ...(selectedAnswer === undefined ? {} : { answer: selectedAnswer }),
            correct: !reviewRequired && q.answer === selectedAnswer,
            ...(reviewRequired ? { reviewRequired: true } : {}),
            hints,
            at: new Date().toISOString(),
            ...(reviewRequired
                ? {}
                : {
                      attemptNumber:
                          attempts().filter(
                              (a) =>
                                  a.exerciseId === q.id &&
                                  !a.reviewRequired &&
                                  (a.phase ?? "practice") === "practice",
                          ).length + 1,
                  }),
            phase: active?.phase ?? "practice",
            difficulty: q.difficulty,
            durationMs: Math.min(durationMs, 3_600_000),
            responseText,
        };
        const mastery = new services.MasteryModel();
        const state = reviewRequired
            ? undefined
            : mastery.update(
                  states().find((s) => s.skill === q.skill) ?? mastery.initial(q.skill),
                  attempt,
              );
        await db.transaction("rw", [db.skills, db.attempts, db.assessments], async () => {
            if ((await db.attempts.count()) >= 50_000)
                throw new Error(
                    "This workspace has reached its limit of 50,000 recorded attempts. Export your records before starting a new workspace.",
                );
            if (!active && !reviewRequired && contributesToGrammarMastery(q.id))
                await db.skills.put(state!);
            await db.attempts.add(attempt);
            if (updated) await db.assessments.put(updated);
        });
        if (updated) {
            if (assessment()?.id === updated.id) setAssessment(updated);
            setAssessments(await db.assessments.toArray());
        }
        setStates(await db.skills.toArray());
        setAttempts(await db.attempts.orderBy("at").toArray());
    }
    async function startAssessment(phase: Assessment["phase"]) {
        const services = await loadFeatureEngine();
        const pending = assessments().find((s) => s.phase === phase && !s.completedAt);
        if (!pending && (await db.assessments.count()) >= 1000)
            throw new Error(
                "This workspace has reached 1,000 assessments. Export your records before starting a new workspace.",
            );
        const active =
            pending ??
            new services.AssessmentService().start(
                phase,
                [...services.exerciseBank, ...mutations()],
                attempts(),
                assessments(),
            );
        if (active.exerciseIds.some((id) => !bank().some((q) => q.id === id)))
            throw new Error(
                "This assessment refers to unavailable source questions. Restore its original materials before resuming.",
            );
        await db.assessments.put(active);
        setAssessments(await db.assessments.toArray());
        setAssessment(active);
        setQuizQueue(undefined);
        setPracticeVisited(true);
        setPage("Practice");
        setQuestion(
            bank().find(
                (q) =>
                    active.exerciseIds.includes(q.id) &&
                    !active.answers.some((a) => a.exerciseId === q.id),
            ),
        );
    }
    async function savePreferences(enabled: boolean, words: string[]) {
        if (words.some((word) => word.trim().length > 100))
            throw new Error(
                "Personal dictionary entries must contain no more than 100 characters.",
            );
        const clean = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(
            0,
            10_000,
        );
        await db.preferences.bulkPut([
            { key: "models", value: enabled, updatedAt: new Date().toISOString() },
            { key: "dictionary", value: clean, updatedAt: new Date().toISOString() },
        ]);
        setModelsEnabled(enabled);
        setDictionary(clean);
        cancel();
        analyze();
    }
    async function backup() {
        const current = commitPending();
        if (current) await persist(current);
        download(
            `linguorithm-backup-${new Date().toISOString().slice(0, 10)}.json`,
            JSON.stringify(await exportBackup(), null, 4),
            "application/json",
        );
        setStatus("Backup exported");
    }
    async function restore(file: File) {
        if (file.size > 30_000_000) throw new Error("Backups must be smaller than 30 MB.");
        const current = commitPending();
        if (current) await persist(current);
        await restoreBackup(JSON.parse(await file.text()));
        if (busy()) cancel();
        await refreshDocuments();
        setStates(await db.skills.toArray());
        setAttempts(await db.attempts.orderBy("at").toArray());
        setMaterials(await db.materials.toArray());
        setAssessments(await db.assessments.toArray());
        const preferences = await db.preferences.toArray();
        setModelsEnabled(preferences.find((p) => p.key === "models")?.value !== false);
        const words = preferences.find((p) => p.key === "dictionary")?.value;
        setDictionary(Array.isArray(words) ? words : []);
        const restored =
            documents().find((item) => item.record.id === current?.record.id) ?? documents()[0];
        if (restored) {
            setDoc(restored);
            setDraft(restored.text);
            setReport(undefined);
            analyze(restored);
        }
        const active = assessment();
        if (active) {
            setAssessment(assessments().find((item) => item.id === active.id));
            await nextQuestion();
        }
        setStatus("Backup restored. Newer local records were preserved.");
    }
    const safely = (action: () => Promise<unknown>) => {
        void action().catch(fail);
    };
    let essayInput: HTMLInputElement = document.createElement("input"),
        materialInput: HTMLInputElement = document.createElement("input"),
        restoreInput: HTMLInputElement = document.createElement("input");
    onMount(() => {
        const updateOnline = () => setOffline(!navigator.onLine);
        window.addEventListener("online", updateOnline);
        window.addEventListener("offline", updateOnline);
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (doc() && draft() !== doc()!.text) {
                event.preventDefault();
            }
        };
        window.addEventListener("beforeunload", beforeUnload);
        onCleanup(() => {
            window.removeEventListener("online", updateOnline);
            window.removeEventListener("offline", updateOnline);
            window.removeEventListener("beforeunload", beforeUnload);
        });
        safely(async () => {
            try {
                await refreshDocuments();
                await reconcileGrammarMastery();
                setStates(await db.skills.toArray());
                setAttempts(await db.attempts.orderBy("at").toArray());
                setMaterials(await db.materials.toArray());
                setAssessments(await db.assessments.toArray());
                const preferences = await db.preferences.toArray();
                setModelsEnabled(preferences.find((p) => p.key === "models")?.value !== false);
                const words = preferences.find((p) => p.key === "dictionary")?.value;
                setDictionary(Array.isArray(words) ? words : []);
            } catch {
                setStorageFailed(true);
                setError(
                    "Browser storage is unavailable. You can analyze and export text, but saving and practice records need IndexedDB.",
                );
            }
            const initial =
                documents()[0] ?? EssayDocument.create(sample, "Learning to look more closely");
            setDoc(initial);
            setDraft(initial.text);
            analyze(initial);
        });
    });
    onCleanup(() => {
        worker?.terminate();
        clearTimeout(saveTimer);
        clearTimeout(timeout);
    });
    createEffect(() => {
        document.title = `${page()} — Linguorithm`;
    });

    return (
        <>
            <a class="skip-link" href="#main">
                Skip to content
            </a>
            <input
                ref={essayInput}
                hidden
                type="file"
                accept=".txt,.md,.markdown,.html,.htm,.docx,.pptx,.xlsx,.pdf"
                onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) void importDocument(f, "essay");
                    e.currentTarget.value = "";
                }}
            />
            <input
                ref={materialInput}
                hidden
                type="file"
                accept=".txt,.md,.markdown,.html,.htm,.docx,.pptx,.xlsx,.pdf"
                onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) void importDocument(f, "material");
                    e.currentTarget.value = "";
                }}
            />
            <input
                ref={restoreInput}
                hidden
                type="file"
                accept=".json"
                onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) safely(() => restore(f));
                    e.currentTarget.value = "";
                }}
            />
            <aside class="sidebar" aria-label="Workspace navigation">
                <a
                    class="brand"
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        setPage("Essay laboratory");
                    }}
                >
                    <img class="brand-symbol" src="./icon.svg" alt="" aria-hidden="true" />
                    <span>
                        Linguorithm<span class="brand-sub">Writing & grammar</span>
                    </span>
                </a>
                <div class="workspace-label">Workspace</div>
                <nav>
                    <For each={nav}>
                        {(item) => (
                            <button
                                classList={{ "nav-item": true, active: page() === item.page }}
                                onClick={() => {
                                    setPage(item.page);
                                    if (item.page === "Practice") {
                                        setPracticeVisited(true);
                                        safely(async () => {
                                            await loadFeatureEngine();
                                            if (!question()) await nextQuestion();
                                        });
                                    } else if (item.page === "Materials")
                                        safely(() => loadFeatureEngine());
                                }}
                                aria-current={page() === item.page ? "page" : undefined}
                            >
                                <Icon name={item.icon} />
                                <span>{item.page}</span>
                            </button>
                        )}
                    </For>
                </nav>
                <div class="sidebar-bottom">
                    <div class="local-indicator">
                        <span />
                        {offline() ? "Offline workspace" : "Local workspace"}
                    </div>
                    <p>Your writing stays on this device.</p>
                    <button class="text-button" onClick={() => setSettings(true)}>
                        Privacy & settings <span>↗</span>
                    </button>
                    <span class="version">Linguorithm 0.2 · American English</span>
                </div>
            </aside>
            <div class="app-body">
                <header class="topbar">
                    <div class="breadcrumb">
                        Workspace <span>/</span> {page()}
                    </div>
                    <span class="top-status">
                        <Icon name="shield" size={15} />
                        <span>Stored on this device</span>
                    </span>
                </header>
                <main id="main" tabindex="-1">
                    <Show when={error()}>
                        <div class="error-banner" role="alert">
                            <span>{error()}</span>
                            <button aria-label="Dismiss error" onClick={() => setError("")}>
                                <Icon name="close" />
                            </button>
                        </div>
                    </Show>
                    <div class="page-heading">
                        <div>
                            <h1 aria-live="polite" aria-atomic="true">
                                {page()}
                            </h1>
                            <p>
                                {page() === "Essay laboratory"
                                    ? "Review your writing, one finding at a time."
                                    : page() === "Practice"
                                      ? "Choose a focus and work through a question."
                                      : page() === "Sentence workbench"
                                        ? "Inspect the words and relationships in your essay."
                                        : page() === "Materials"
                                          ? "Turn explicit grammar definitions and examples into source-linked practice."
                                          : "Review your practice history and the skills due for another attempt."}
                            </p>
                        </div>
                        <Show when={page() === "Essay laboratory"}>
                            <button
                                class="button secondary"
                                disabled={loadingFile()}
                                onClick={() => essayInput.click()}
                            >
                                <Icon name="upload" size={17} />
                                {loadingFile() ? "Reading file…" : "Import essay"}
                            </button>
                        </Show>
                        <Show when={page() === "Materials"}>
                            <button
                                class="button primary"
                                disabled={loadingFile()}
                                onClick={() => materialInput.click()}
                            >
                                <Icon name="plus" size={17} />
                                {loadingFile() ? "Reading file…" : "Import material"}
                            </button>
                        </Show>
                    </div>
                    <Show when={page() === "Essay laboratory"}>
                        <EssayLab
                            doc={doc()}
                            draft={draft()}
                            report={report()}
                            diagnostics={visible()}
                            active={activeDiagnostic()}
                            stale={stale()}
                            busy={busy()}
                            editing={editing()}
                            style={style()}
                            writingIntent={doc()?.record.writingIntent ?? "general"}
                            reviewMode={reviewMode()}
                            documents={documents()}
                            status={status()}
                            onEdit={setEditing}
                            onText={changeText}
                            onAnalyze={() => analyze()}
                            onCancel={cancel}
                            onSelect={setSelected}
                            onApply={apply}
                            onIgnore={(d) => setIgnored([...ignored(), d.id])}
                            onHistory={history}
                            onStyle={(v) => {
                                setStyle(v);
                                analyze();
                            }}
                            onIntent={changeWritingIntent}
                            onReviewMode={setReviewMode}
                            onOpen={(d) => safely(() => openDocument(d))}
                            onNew={() => safely(() => newDocument())}
                            onTitle={(title) => {
                                const current = doc();
                                if (current && title.trim()) {
                                    const updated = new EssayDocument({
                                        ...current.record,
                                        title: title.trim(),
                                        updatedAt: new Date(
                                            Math.max(
                                                Date.now(),
                                                Date.parse(current.record.updatedAt) + 1,
                                            ),
                                        ).toISOString(),
                                    });
                                    setDoc(updated);
                                    safely(() => persist(updated));
                                }
                            }}
                            onExport={() =>
                                download(`${doc()?.record.title ?? "essay"}.txt`, draft())
                            }
                            onPractice={startPractice}
                        />
                    </Show>
                    <Show when={page() === "Sentence workbench"}>
                        <Suspense
                            fallback={
                                <div class="analysis-placeholder" role="status">
                                    <p>Opening the sentence workbench…</p>
                                </div>
                            }
                        >
                            <Workbench
                                report={report()}
                                stale={stale()}
                                onAnalyze={() => analyze()}
                                onPractice={startPractice}
                            />
                        </Suspense>
                    </Show>
                    <div hidden={page() !== "Practice"}>
                        <Show when={practiceVisited()}>
                            <Suspense
                                fallback={
                                    <div class="analysis-placeholder" role="status">
                                        <p>Opening practice…</p>
                                    </div>
                                }
                            >
                                <Practice
                                    onRepairs={() => {
                                        setAssessment(undefined);
                                        setQuestion(undefined);
                                        setQuizQueue(mutations().slice(1));
                                        setQuestion(mutations()[0]);
                                    }}
                                    assessment={assessment()}
                                    question={question()}
                                    sourceQuiz={quizQueue() !== undefined}
                                    states={states()}
                                    filter={practiceSkill()}
                                    onFilter={(s) => {
                                        setAssessment(undefined);
                                        setQuizQueue(undefined);
                                        setPracticeSkill(s);
                                        setQuestion(undefined);
                                        safely(() => nextQuestion(s));
                                    }}
                                    onNext={() => safely(() => nextQuestion())}
                                    onAnswer={answer}
                                    onError={fail}
                                />
                            </Suspense>
                        </Show>
                    </div>
                    <Show when={page() === "Materials"}>
                        <section class="materials-layout">
                            <div class="material-list">
                                <div class="section-label">
                                    Source library <span>{materials().length} materials</span>
                                </div>
                                <Show
                                    when={materials().length}
                                    fallback={
                                        <div class="empty-state">
                                            <Icon name="library" size={35} />
                                            <h2>Your source library is empty</h2>
                                            <p>
                                                Import notes, a handout, or a grammar chapter. Text
                                                stays on this device.
                                            </p>
                                            <button
                                                class="button secondary"
                                                onClick={() => materialInput.click()}
                                            >
                                                Choose a file <Icon name="arrow" size={16} />
                                            </button>
                                        </div>
                                    }
                                >
                                    <For each={materials()}>
                                        {(m) => (
                                            <article class="material-row">
                                                <div class="file-mark">{m.format}</div>
                                                <div>
                                                    <h2>{m.name}</h2>
                                                    <p>
                                                        {m.text.split(/\s+/u).length} words ·{" "}
                                                        {new Date(
                                                            m.importedAt,
                                                        ).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                <button
                                                    class="button secondary"
                                                    onClick={() =>
                                                        safely(async () => {
                                                            const { QuizAssembler } =
                                                                await loadFeatureEngine();
                                                            const quiz =
                                                                new QuizAssembler().fromMaterial(m);
                                                            setMaterialQuestions(quiz.exercises);
                                                            setQuestion(undefined);
                                                            setStatus(quiz.limitations[0]!);
                                                        })
                                                    }
                                                >
                                                    Build quiz <Icon name="arrow" size={15} />
                                                </button>
                                                <button
                                                    class="icon-button"
                                                    aria-label={`Delete ${m.name}`}
                                                    onClick={() =>
                                                        safely(async () => {
                                                            await db.materials.delete(m.id);
                                                            setMaterials(
                                                                await db.materials.toArray(),
                                                            );
                                                            setMaterialQuestions(
                                                                materialQuestions().filter(
                                                                    (q) =>
                                                                        !q.id.startsWith(
                                                                            `material:${m.id}:`,
                                                                        ),
                                                                ),
                                                            );
                                                            setQuestion(undefined);
                                                        })
                                                    }
                                                >
                                                    <Icon name="close" size={16} />
                                                </button>
                                            </article>
                                        )}
                                    </For>
                                </Show>
                            </div>
                            <aside class="material-guide">
                                <h2>How source practice works</h2>
                                <ol>
                                    <li>Extract the text locally.</li>
                                    <li>Match explicit definitions and supported errors.</li>
                                    <li>Validate the answer and retain the source.</li>
                                </ol>
                                <p>
                                    Text, Markdown, HTML, Word, PowerPoint, Excel, and text-based
                                    PDF. No invented summaries or questions about unsupported facts.
                                </p>
                            </aside>
                        </section>
                        <div class="material-result" role="status">
                            <p>{status()}</p>
                            <For each={materialStructures()}>
                                {(entry) => (
                                    <details>
                                        <summary>
                                            Explore source structure · {entry.material.name}
                                        </summary>
                                        <p>
                                            {entry.extraction.blocks.length} blocks ·{" "}
                                            {entry.extraction.definitions.length} explicit
                                            definitions
                                        </p>
                                        <p>
                                            Key phrases:{" "}
                                            {entry.extraction.keyPhrases
                                                .slice(0, 12)
                                                .map((p) => p.phrase)
                                                .join(" · ") || "No supported phrases"}
                                        </p>
                                        <For each={entry.extraction.blocks.slice(0, 100)}>
                                            {(b) => (
                                                <p class="source-block">
                                                    <strong>
                                                        {b.kind}
                                                        {b.page ? ` · page ${b.page}` : ""}
                                                    </strong>{" "}
                                                    · characters {b.start}–{b.end}
                                                    <br />
                                                    {b.text}
                                                </p>
                                            )}
                                        </For>
                                    </details>
                                )}
                            </For>
                            <Show when={materialQuestions().length}>
                                <button
                                    class="button primary"
                                    onClick={() => {
                                        setAssessment(undefined);
                                        setPracticeVisited(true);
                                        setPage("Practice");
                                        setPracticeSkill(undefined);
                                        setQuizQueue(materialQuestions().slice(1));
                                        setQuestion(materialQuestions()[0]);
                                    }}
                                >
                                    Practice {materialQuestions().length} questions{" "}
                                    <Icon name="arrow" size={17} />
                                </button>
                                <For each={materialQuestions()}>
                                    {(q) => (
                                        <details>
                                            <summary>
                                                {q.prompt} <span>{q.source.name}</span>
                                            </summary>
                                            <blockquote>{q.source.quote}</blockquote>
                                            <p>
                                                {q.source.location} · {q.validation}
                                            </p>
                                        </details>
                                    )}
                                </For>
                            </Show>
                        </div>
                    </Show>
                    <Show when={page() === "Your progress"}>
                        <Suspense
                            fallback={
                                <div class="analysis-placeholder" role="status">
                                    <p>Opening your progress…</p>
                                </div>
                            }
                        >
                            <Progress
                                assessments={assessments()}
                                onAssessment={(phase) => safely(() => startAssessment(phase))}
                                onExport={() =>
                                    safely(async () => {
                                        const { ProgressExporter } = await loadFeatureEngine();
                                        download(
                                            "linguorithm-learning-records.csv",
                                            new ProgressExporter().csv(attempts()),
                                            "text/csv",
                                        );
                                    })
                                }
                                states={states()}
                                attempts={attempts()}
                                onPractice={startPractice}
                                onBackup={() => safely(backup)}
                                onRestore={() => restoreInput.click()}
                            />
                        </Suspense>
                    </Show>
                    <footer class="page-footer">
                        <span>Linguorithm · American English</span>
                        <button onClick={() => setSettings(true)}>
                            Engine notes <span>↗</span>
                        </button>
                    </footer>
                </main>
            </div>
            <Show when={settings()}>
                <div
                    class="modal-backdrop"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setSettings(false);
                    }}
                >
                    <Settings
                        models={modelsEnabled()}
                        dictionary={dictionary()}
                        onPreferences={(enabled, words) =>
                            safely(() => savePreferences(enabled, words))
                        }
                        report={report()}
                        onClose={() => setSettings(false)}
                        onBackup={() => safely(backup)}
                        onRestore={() => restoreInput.click()}
                    />
                </div>
            </Show>
        </>
    );
}

function Settings(props: {
    models: boolean;
    dictionary: readonly string[];
    onPreferences: (enabled: boolean, words: string[]) => void;
    report?: AnalysisReport;
    onClose: () => void;
    onBackup: () => void;
    onRestore: () => void;
}) {
    const [enabled, setEnabled] = createSignal(props.models);
    const [words, setWords] = createSignal(props.dictionary.join("\n"));
    let panel: HTMLDivElement = document.createElement("div");
    onMount(() => {
        const previous = document.activeElement as HTMLElement | null;
        panel.focus();
        onCleanup(() => previous?.focus());
    });
    return (
        <div
            ref={panel}
            class="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            tabindex="-1"
            onKeyDown={(e) => {
                if (e.key === "Escape") props.onClose();
                if (e.key === "Tab") {
                    const items = panel.querySelectorAll<HTMLElement>(
                        "button, a, input, textarea, select",
                    );
                    const first = items[0],
                        last = items[items.length - 1];
                    if (
                        e.shiftKey &&
                        (document.activeElement === first || document.activeElement === panel)
                    ) {
                        e.preventDefault();
                        last?.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first?.focus();
                    }
                }
            }}
        >
            <button
                class="modal-close icon-button"
                onClick={props.onClose}
                aria-label="Close settings"
            >
                <Icon name="close" />
            </button>
            <div class="eyebrow">Your workspace, your control</div>
            <h2 id="settings-title">Privacy & engine notes</h2>
            <h3>Local means local.</h3>
            <p>
                Essays, materials, and learning progress are saved in this browser using IndexedDB.
                There are no accounts, analytics, external fonts, generative services, or essay
                uploads. Optional server analysis and synchronization are not enabled in this
                release.
            </p>
            <h3>What the engine can tell you</h3>
            <p>
                {props.report?.modelStatus?.detail ??
                    "Analysis capabilities will appear after the first analysis."}{" "}
                The shipped tagger and parser are trained on the licensed English Web Treebank.
                Error-classifier calibration is limited to controlled synthetic mutations; neural
                findings are review-only on essays. An unmarked essay may still contain errors.
            </p>
            <h3>Keep a copy.</h3>
            <label>
                <input
                    type="checkbox"
                    checked={enabled()}
                    onChange={(e) => setEnabled(e.currentTarget.checked)}
                />{" "}
                Enable local neural models
            </label>
            <p>
                Turning models off keeps deterministic rules available. American English is the
                installed spelling variety.
            </p>
            <label for="personal-dictionary">Personal dictionary · one word per line</label>
            <textarea
                id="personal-dictionary"
                rows="4"
                maxlength="100000"
                value={words()}
                onInput={(e) => setWords(e.currentTarget.value)}
            />
            <button
                class="button secondary"
                onClick={() => props.onPreferences(enabled(), words().split(/\s+/u))}
            >
                Save analysis preferences
            </button>
            <p>
                Browser storage can be cleared or evicted and is not encrypted secure storage.
                Export backups regularly. Restore merges data and preserves newer local document
                revisions.
            </p>
            <div class="button-row">
                <button class="button primary" onClick={props.onBackup}>
                    <Icon name="download" size={16} />
                    Export backup
                </button>
                <button class="button secondary" onClick={props.onRestore}>
                    <Icon name="upload" size={16} />
                    Restore backup
                </button>
            </div>
            <p class="small-print">
                Engine 0.2.0 · Rules 1.1.0 · Curriculum 1.1.0
                <br />
                Independent accuracy and learning-effectiveness benchmarks are not yet established.
            </p>
        </div>
    );
}
