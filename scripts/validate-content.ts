import {
    buildMutationBank,
    exerciseBank,
    SkillGraph,
    validateExercise,
} from "../packages/engine/src/index";
import { readFileSync } from "node:fs";
if (readFileSync("oxfmt.json", "utf8") !== readFileSync(".oxfmtrc.json", "utf8"))
    throw new Error("The discovered Oxfmt configuration must exactly match oxfmt.json.");
new SkillGraph();
const ids = new Set<string>();
for (const q of [...exerciseBank, ...buildMutationBank()]) {
    if (ids.has(q.id)) throw new Error(`Duplicate ${q.id}`);
    ids.add(q.id);
    const errors = validateExercise(q);
    if (errors.length) throw new Error(`${q.id}: ${errors.join("; ")}`);
}
console.log(
    `Validated ${ids.size} authored and verified-mutation exercises, answer keys, option uniqueness, hints, provenance, and skill graph.`,
);
