import { cpus, platform, arch } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { createPipeline } from "../packages/engine/src/index";

const paragraph =
    "The students in the laboratory are ready. The collection of essays is on the desk. She has written an interesting explanation. An hour of careful practice can help a writer understand the relationship between a subject and its verb. However, learning takes time. We work together and we discuss the evidence. The findings support a clear conclusion. A useful example reveals the structure of a sentence. They write their observations in a notebook. Each lesson gives students a new opportunity to examine a different construction. The teacher offers a question and the students explain their reasoning. They can learn from both correct answers and mistakes. Good writing begins with careful observation. Read the passage again and look for connections.";
const essay = Array.from(
    { length: Math.ceil(2500 / paragraph.split(/\s+/u).length) },
    () => paragraph,
).join("\n\n");
const pipeline = createPipeline();
const cold: number[] = [],
    warm: number[] = [];
let sampledPeakHeap = 0;
for (let i = 0; i < 30; i++) {
    cold.push(createPipeline().analyze(essay).elapsedMs);
    warm.push(pipeline.analyze(essay).elapsedMs);
    sampledPeakHeap = Math.max(sampledPeakHeap, process.memoryUsage().heapUsed);
}
const summarize = (values: number[]) => {
    const ordered = [...values].sort((a, b) => a - b);
    return {
        p50: ordered[Math.floor(ordered.length * 0.5)],
        p95: ordered[Math.floor(ordered.length * 0.95)],
    };
};
const result = {
    workload:
        "Original synthetic valid prose with repeated paragraphs; favorable to paragraph caching",
    words: essay.split(/\s+/u).length,
    samples: 30,
    coldMs: summarize(cold),
    warmMs: summarize(warm),
    sampledPeakProcessHeapBytes: sampledPeakHeap,
    environment: {
        node: process.version,
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
    },
    limitations:
        "Node engine timing only. Not browser worker roundtrip, actual peak memory, model initialization, representative essay distribution, or mobile performance.",
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/performance.json", JSON.stringify(result, null, 4) + "\n");
console.log(JSON.stringify(result, null, 2));
