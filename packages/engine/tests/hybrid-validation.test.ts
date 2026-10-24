import { describe, expect, it } from "vitest";
import { EssayDocument, type Diagnostic, type Sentence } from "../src/domain";
import { HybridAnalysisPipeline, type AsyncSyntax } from "../src/hybrid";
import { finding } from "../src/grammar";
import { LexicalTagger, Tokenizer } from "../src/text";

function parsed(text: string, comparisons = 0): Sentence {
    const tokens = new LexicalTagger().tag(new Tokenizer().tokenize(text));
    const graph = [
        ["better", "more"],
        ["best", "most"],
    ]
        .slice(0, comparisons)
        .map(([head, dependent]) => ({
            head: tokens.findIndex((t) => t.text === head),
            dependent: tokens.findIndex((t) => t.text === dependent),
            relation: "advmod",
        }));
    return {
        id: "fixture",
        text,
        start: 0,
        end: text.length,
        tokens,
        graph,
        ambiguous: false,
        syntaxSource: "neural",
    };
}

function pipeline(options: Partial<AsyncSyntax> = {}) {
    return new HybridAnalysisPipeline({
        lexicon: { frequency: {} },
        metadata: { version: "controlled-validation-fixture", limitations: [] },
        sentence: async (s) => parsed(s.text),
        ...options,
    });
}

describe("hybrid proposal safety across analysis stages", () => {
    it("withholds a fallback repair when its neural reparse reveals a new constraint", async () => {
        const report = await pipeline({
            sentence: async (s) => parsed(s.text, s.text.includes(" are ") ? 1 : 0),
        }).analyze("They is more better.");
        const issue = report.diagnostics.find((d) => d.ruleId === "agreement");
        expect(issue).toBeDefined();
        expect(issue!.proposals).toEqual([]);
    });

    it("reparses dictionary alternatives and withholds newly introduced grammar findings", async () => {
        const reparses: string[] = [];
        const report = await pipeline({
            dictionary: ["this", "reads", "more", "better"],
            lexicon: { frequency: { better: 500 } },
            sentence: async (s) => {
                reparses.push(s.text);
                return parsed(s.text, s.text.includes("better") ? 1 : 0);
            },
        }).analyze("This reads more bettr.");
        const issue = report.diagnostics.find((d) => d.ruleId === "dictionary-spelling");
        expect(issue).toBeDefined();
        expect(reparses).toContain("This reads more better.");
        expect(issue!.proposals).toEqual([]);
    });

    it("rejects an increased finding count even when the same rule already existed", async () => {
        const report = await pipeline({
            sentence: async (s) => parsed(s.text, s.text.includes(" are ") ? 2 : 1),
        }).analyze("They is more better and most best.");
        expect(report.diagnostics.find((d) => d.ruleId === "agreement")!.proposals).toEqual([]);
    });

    it("rejects a newly located finding even when the rule count stays unchanged", async () => {
        const report = await pipeline({
            sentence: async (s) => {
                const result = parsed(s.text, 2);
                return {
                    ...result,
                    graph: [result.graph[s.text.includes(" are ") ? 1 : 0]!],
                };
            },
        }).analyze("They is more better and most best.");
        expect(report.diagnostics.find((d) => d.ruleId === "agreement")!.proposals).toEqual([]);
    });

    it("withholds a repair when the contextual classifier detects a new supported issue", async () => {
        const classify = async (s: Sentence): Promise<Diagnostic[]> =>
            s.text.includes(" are ")
                ? [
                      finding(
                          s,
                          "model-agreement",
                          "agreement",
                          s.tokens[1]!,
                          "Grammar",
                          "Controlled classifier finding",
                          "The test classifier reports an issue only after the candidate edit.",
                          [],
                          "Possible issue",
                      ),
                  ]
                : [];
        const report = await pipeline({ classify }).analyze("They is ready.");
        expect(report.diagnostics.find((d) => d.ruleId === "agreement")!.proposals).toEqual([]);
    });

    it("retains a safe bounded repair and its original document offsets", async () => {
        const text = "Students are ready.\n\nThey is ready.";
        const report = await pipeline().analyze(text);
        const issue = report.diagnostics.find((d) => d.ruleId === "agreement")!;
        expect(issue.proposals).toHaveLength(1);
        expect(issue.proposals[0]!.validation?.status).toBe("rechecked");
        expect(EssayDocument.create(text).apply(issue.proposals[0]!).text).toBe(
            "Students are ready.\n\nThey are ready.",
        );
    });

    it("preserves supported lexical repairs beyond the neural token limit", async () => {
        const text = `They is ready ${Array.from({ length: 135 }, () => "today").join(" ")}.`;
        const report = await pipeline({
            // The production runtime preserves the supplied lexical parse above its limit.
            sentence: async (s) => (s.tokens.length > 128 ? s : parsed(s.text)),
        }).analyze(text);
        const issue = report.diagnostics.find((d) => d.ruleId === "agreement")!;
        expect(issue.proposals).toHaveLength(1);
        expect(EssayDocument.create(text).apply(issue.proposals[0]!).text).toBe(
            text.replace("They is", "They are"),
        );
    });
});
