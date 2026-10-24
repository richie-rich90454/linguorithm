import {
    createPipeline,
    HybridAnalysisPipeline,
    type AnalysisReport,
    type WritingIntent,
} from "@grammar/engine";
import { LocalSyntaxRuntime } from "./local-syntax";

const fallback = createPipeline();
let hybrid: Promise<HybridAnalysisPipeline> | undefined;
let runtime: Promise<LocalSyntaxRuntime> | undefined;
function loadRuntime(assetBase: string): Promise<LocalSyntaxRuntime> {
    if (!runtime) {
        const pending = LocalSyntaxRuntime.load(assetBase);
        runtime = pending;
        // Share a pending load, but let a later analysis retry transient initialization failures.
        void pending.catch(() => {
            if (runtime === pending) {
                runtime = undefined;
                hybrid = undefined;
            }
        });
    }
    return runtime;
}
self.onmessage = async (
    event: MessageEvent<{
        id: number;
        text: string;
        revision: number;
        style: boolean;
        writingIntent?: WritingIntent;
        assetBase?: string;
        models?: boolean;
        personalDictionary?: string[];
        type?: "parity";
        inputs?: { words: number[]; chars: number[][] }[];
    }>,
) => {
    const {
        id,
        text,
        revision,
        style,
        writingIntent = "general",
        models = true,
        assetBase = new URL("../", self.location.href).href,
        personalDictionary = [],
    } = event.data;
    try {
        if (event.data.type === "parity") {
            const instance = await loadRuntime(assetBase);
            if (
                !event.data.inputs ||
                event.data.inputs.length > 30 ||
                event.data.inputs.some(
                    (input) =>
                        !input.words.length ||
                        input.words.length > 128 ||
                        input.chars.length !== input.words.length ||
                        input.chars.some((c) => c.length !== 24),
                )
            )
                throw new Error("Invalid parity test inputs.");
            const emissions = [];
            for (const input of event.data.inputs)
                emissions.push(await instance.emissions(input.words, input.chars));
            self.postMessage({ id, emissions });
            return;
        }
        let report: AnalysisReport;
        if (models) {
            try {
                hybrid ??= loadRuntime(assetBase).then(
                    (model) => new HybridAnalysisPipeline(model),
                );
                report = await (
                    await hybrid
                ).analyze(text, revision, style, personalDictionary, writingIntent);
            } catch (error) {
                report = {
                    ...fallback.analyze(text, revision, style, writingIntent),
                    modelStatus: {
                        state: "unavailable",
                        detail:
                            error instanceof Error
                                ? error.message
                                : "Local models could not initialize.",
                        tasks: [],
                    },
                };
            }
        } else
            report = {
                ...fallback.analyze(text, revision, style, writingIntent),
                modelStatus: {
                    state: "disabled",
                    detail: "Advanced local models are disabled by preference.",
                    tasks: [],
                },
            };
        const personal = new Set(personalDictionary.map((w) => w.toLowerCase()));
        report = {
            ...report,
            diagnostics: report.diagnostics.filter(
                (d) =>
                    !(
                        d.category === "Spelling" &&
                        personal.has(text.slice(d.start, d.end).toLowerCase())
                    ),
            ),
        };
        self.postMessage({ id, report });
    } catch (error) {
        self.postMessage({
            id,
            error: error instanceof Error ? error.message : "Analysis failed.",
        });
    }
};
