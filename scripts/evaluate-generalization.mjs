import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preview } from "vite";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const fixturePath = "content/generalization-syntax.json";
const seed = 20261024;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function corpus(path) {
    return readFileSync(path, "utf8")
        .split(/\r?\n\r?\n/u)
        .flatMap((block) => {
            const id = block.match(/^# sent_id = (.+)$/mu)?.[1];
            const text = block.match(/^# text = (.+)$/mu)?.[1];
            const tokens = block
                .split(/\r?\n/u)
                .filter((line) => /^\d+\t/u.test(line))
                .map((line) => {
                    const fields = line.split("\t");
                    return {
                        text: fields[1],
                        lemma: fields[2],
                        pos: fields[3],
                        features: fields[5],
                        head: Number(fields[6]),
                        relation: fields[7],
                    };
                });
            if (!id || !text || !tokens.length || tokens.length > 128) return [];
            return [{ id, group: id.replace(/-[^-]+$/u, ""), text, tokens }];
        });
}

function prepareFixture() {
    const directory = "training/datasets/raw/ewt";
    const manifest = json("training/datasets/ewt-manifest.json");
    const seen = new Set(),
        groups = new Set(),
        splitCounts = {};
    let test = [];
    for (const split of ["train", "dev", "test"]) {
        const file = `en_ewt-ud-${split}.conllu`;
        if (hash(readFileSync(`${directory}/${file}`)) !== manifest.files[file].sha256)
            throw new Error(`Pinned corpus hash mismatch: ${file}`);
        const rows = corpus(`${directory}/${file}`);
        const filtered = rows.filter(
            (row) =>
                !seen.has(JSON.stringify(row.tokens.map((t) => t.text))) && !groups.has(row.group),
        );
        splitCounts[split] = { lengthBounded: rows.length, deduplicated: filtered.length };
        for (const row of filtered) {
            seen.add(JSON.stringify(row.tokens.map((t) => t.text)));
            groups.add(row.group);
        }
        if (split === "test") test = filtered;
    }
    let alignmentExcluded = 0;
    const aligned = test.filter((row) => {
        let offset = 0;
        for (const token of row.tokens) {
            const start = row.text.indexOf(token.text, offset);
            // Unaligned contractions, transformed UD words, and missing text cannot be scored by spans.
            if (start < 0 || row.text.slice(offset, start).trim()) {
                alignmentExcluded++;
                return false;
            }
            token.start = start;
            token.end = start + token.text.length;
            offset = token.end;
        }
        if (row.text.slice(offset).trim()) {
            alignmentExcluded++;
            return false;
        }
        return true;
    });
    // Hash ordering gives a seed-fixed sample independent of file traversal order.
    const selected = aligned
        .sort((a, b) => hash(`${seed}:${a.id}`).localeCompare(hash(`${seed}:${b.id}`)))
        .slice(0, 300);
    const fixture = {
        format: "syntax-generalization-gold-v1",
        seed,
        source: manifest.source,
        sourceRelease: manifest.release,
        sourceCommit: manifest.commit,
        sourceFile: manifest.files["en_ewt-ud-test.conllu"],
        license: "CC-BY-SA-4.0",
        licenseFile: "generalization-syntax.LICENSE.txt",
        attribution:
            "Universal Dependencies English Web Treebank contributors. Annotations copyright 2013–2021 The Board of Trustees of The Leland Stanford Junior University. Underlying source texts retain their respective authors' rights; see retained source README.",
        sourceReadme: "generalization-syntax.ATTRIBUTION.md",
        adaptation:
            "Selected official-test sentences and projected gold token spans/UPOS/basic dependency heads/relations; no gold annotation changed. Offsets are JavaScript UTF-16 indices.",
        scope: "Held-out from model training, but drawn from the same public corpus used for model development/test reporting. This is neither a newly independent dataset nor an error-annotated learner-essay benchmark. Author/prompt independence is unverified.",
        selection: {
            method: "Seeded SHA-256 ordering of eligible official-test sentence IDs; first 300, before inspecting model predictions",
            splitCounts,
            sourceAlignedCandidates: aligned.length,
            sourceAlignmentExcluded: alignmentExcluded,
            tokenLimit: 128,
            deduplication:
                "Exact token sequences and document groups excluded against official train and dev, matching training/train_release.py policy. Sentences with UD tokens that cannot exactly align to original text are excluded before sampling.",
        },
        cases: selected,
    };
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 4) + "\n");
    copyFileSync(`${directory}/LICENSE.txt`, "content/generalization-syntax.LICENSE.txt");
    copyFileSync(`${directory}/README.md`, "content/generalization-syntax.ATTRIBUTION.md");
    console.log(
        JSON.stringify(
            { fixture: fixturePath, sentences: selected.length, selection: fixture.selection },
            null,
            2,
        ),
    );
}

if (process.argv.includes("--prepare")) {
    prepareFixture();
    process.exit(0);
}
if (!existsSync(fixturePath))
    throw new Error(
        "Missing tracked gold fixture; use --prepare only with the pinned local raw EWT corpus.",
    );
const fixture = json(fixturePath);
const clean = [
    [
        "astronomy",
        "The telescope that the technicians calibrated last winter detects faint signals beyond the visible spectrum.",
    ],
    [
        "medicine",
        "Neither the surgeon nor the nurses were certain whether the patient had taken the medication.",
    ],
    [
        "ecology",
        "Although the estuary appears calm, the currents beneath its surface transport sediment toward the open sea.",
    ],
    [
        "software",
        "Each request is assigned an identifier before the server writes the response to the cache.",
    ],
    [
        "finance",
        "The figures in the revised forecast are consistent with the assumptions that the auditors approved.",
    ],
    [
        "history",
        "What the witnesses remembered was less precise than what the surviving letters revealed.",
    ],
    [
        "formal-subjunctive",
        "The board recommended that the director be present when the final decision is announced.",
    ],
    [
        "subjunctive-conditional",
        "Were the archive to close, researchers would lose access to records that exist nowhere else.",
    ],
    [
        "coordination",
        "The pianist and the cellist rehearse in a room whose windows overlook the courtyard.",
    ],
    [
        "passive",
        "The samples have been stored in sealed containers and will be examined after the instruments are calibrated.",
    ],
    [
        "rare-verb",
        "The historian scrutinizes the marginal notes while her colleagues transcribe the damaged pages.",
    ],
    [
        "relative-clause",
        "The woman to whom the parcel was addressed no longer lives at the address printed on the label.",
    ],
    [
        "embedded-clause",
        "The claim that the results were fabricated surprised the researchers who had collected the original data.",
    ],
    [
        "participle",
        "Having weighed the alternatives, the committee postponed its decision until the missing evidence arrived.",
    ],
    [
        "quoted-speech",
        "“The measurements are consistent,” Maya said, “but the explanation remains uncertain.”",
    ],
    [
        "unicode",
        "Zoë wrote, “The café’s new menu looks excellent 😀,” before closing her notebook.",
    ],
    [
        "contraction",
        "She doesn't believe the report is accurate because the figures aren't complete.",
    ],
    ["lowercase-correct-agreement", "the archivist scrutinizes each manuscript carefully."],
    ["past-homograph-read", "Yesterday she read the final chapter aloud."],
    ["past-homograph-cut", "Last year, the children cut the paper into narrow strips."],
    [
        "question",
        "Which of the manuscripts that the librarian found contains the missing final chapter?",
    ],
    [
        "imperative",
        "Place the sealed envelope beside the ledger, and leave the remaining documents where you found them.",
    ],
    [
        "negation",
        "The absence of a warning does not establish that every possible error has been detected.",
    ],
    ["legal-style", "Any participant who wishes to withdraw may do so without providing a reason."],
    ["math", "If the sequence converges, every subsequence converges to the same limit."],
    ["concessive", "However carefully the evidence is presented, some uncertainty will remain."],
];
const positives = [
    {
        id: "rare-lexical-agreement",
        text: "The archivist scrutinize each damaged manuscript before cataloguing it.",
        skill: "agreement",
        original: "scrutinize",
        replacement: "scrutinizes",
    },
    {
        id: "lowercase-lexical-agreement",
        text: "the archivist scrutinize each manuscript carefully.",
        skill: "agreement",
        original: "scrutinize",
        replacement: "scrutinizes",
    },
    {
        id: "plural-lexical-agreement",
        text: "The geologists examines the mineral samples beneath a bright lamp.",
        skill: "agreement",
        original: "examines",
        replacement: "examine",
    },
    {
        id: "intervening-phrase",
        text: "The arrangement of the stained glass panels are unusually intricate.",
        skill: "agreement",
        original: "are",
        replacement: "is",
    },
    {
        id: "passive-agreement",
        text: "The sealed containers was transported to the coastal laboratory.",
        skill: "agreement",
        original: "was",
        replacement: "were",
    },
    {
        id: "perfect-participle",
        text: "The curator has chose a different painting for the exhibition.",
        skill: "verb-forms",
        original: "chose",
        replacement: "chosen",
    },
    {
        id: "corpus-derived-perfect-drive",
        text: "The pilots have drove the aircraft through heavy rain.",
        skill: "verb-forms",
        original: "drove",
        replacement: "driven",
    },
    {
        id: "corpus-derived-perfect-give",
        text: "The technicians have gave their approval after the inspection.",
        skill: "verb-forms",
        original: "gave",
        replacement: "given",
    },
    {
        id: "modal-inflection",
        text: "The observatory can detects objects beyond the visible horizon.",
        skill: "verb-forms",
        original: "detects",
        replacement: "detect",
    },
    {
        id: "article-vowel",
        text: "The inspector requested a explanation for the missing samples.",
        skill: "usage",
        original: "a",
        replacement: "an",
    },
    {
        id: "article-consonant",
        text: "The librarian recommended an portable lamp for the reading room.",
        skill: "usage",
        original: "an",
        replacement: "a",
    },
    {
        id: "duplicated-token",
        text: "The sculpture stood beside the the entrance to the gallery.",
        skill: "usage",
        original: " the",
        replacement: "",
        occurrence: 1,
    },
    {
        id: "new-spelling",
        text: "The meteorologist recorded the atmospheric presure at noon.",
        skill: "usage",
        original: "presure",
        replacement: "pressure",
    },
    {
        id: "comma-boundary",
        text: "The storm damaged the lighthouse, the keeper repaired the lamp.",
        skill: "boundaries",
        original: ",",
        replacement: ";",
    },
    {
        id: "pronoun-case",
        text: "Him supervises the restoration of the damaged sculpture.",
        skill: "pronouns",
        original: "Him",
        replacement: "He",
    },
];
const special = [
    {
        id: "all-caps-ambiguous",
        text: "THE ARCHIVIST SCRUTINIZE EACH MANUSCRIPT CAREFULLY.",
        kind: "ambiguous-case",
        expectation:
            "All-caps input can be confused with names by the tagger; an ambiguous parse must abstain from a correction.",
    },
    {
        id: "heading-fragment",
        text: "Beyond the northern ridge",
        kind: "fragment",
        expectation:
            "A heading-like fragment may warrant review; no automatic rewrite should be required.",
    },
    {
        id: "dependent-fragment",
        text: "Although the instrument had been calibrated twice.",
        kind: "fragment",
        expectation: "Dependent-clause fragment: check findings and abstentions transparently.",
    },
    {
        id: "nonenglish-chinese",
        text: "这些研究人员昨天完成了实验，并且仔细记录了所有结果。",
        kind: "non-English",
        expectation: "No English correction proposals on unsupported-language text.",
    },
    {
        id: "nonenglish-spanish",
        text: "Los investigadores examinaron cuidadosamente las muestras antes de publicar sus resultados.",
        kind: "non-English",
        expectation: "No English correction proposals on unsupported-language text.",
    },
    {
        id: "nonenglish-french",
        text: "Les chercheurs ont analysé les données avant de présenter leurs conclusions au comité.",
        kind: "non-English",
        expectation: "No English correction proposals on unsupported-language text.",
    },
    {
        id: "long-bounded-sentence",
        text: `The researchers who had spent several months comparing the records from different observatories reported that ${Array.from({ length: 18 }, (_, i) => `the measurements from station ${i + 1} were consistent with the earlier estimates`).join(", and that ")}.`,
        kind: "long",
        expectation:
            "More than 128 tokens: preserve source offsets and bounded behavior; report whether neural syntax was skipped.",
    },
];

function targetSpan(item) {
    if (/^[a-z]+$/iu.test(item.original)) {
        const matches = [...item.text.matchAll(new RegExp(`\\b${item.original}\\b`, "gu"))];
        const match = matches[item.occurrence ?? 0];
        if (!match) throw new Error(`Challenge target missing: ${item.id}`);
        return { start: match.index, end: match.index + item.original.length };
    }
    let start = -1;
    for (let i = 0; i <= (item.occurrence ?? 0); i++)
        start = item.text.indexOf(item.original, start + 1);
    if (start < 0) throw new Error(`Challenge target missing: ${item.id}`);
    return { start, end: start + item.original.length };
}

function mutation(row) {
    for (const subject of row.tokens.filter((token) => token.relation === "nsubj")) {
        if (/^(I|you|none|team|staff|family|committee)$/iu.test(subject.text)) continue;
        const number = subject.features.match(/(?:^|\|)Number=(Sing|Plur)(?:\||$)/u)?.[1];
        if (
            !number ||
            row.tokens.some(
                (t) => t.head === row.tokens.indexOf(subject) + 1 && t.relation === "conj",
            )
        )
            continue;
        const predicate = subject.head;
        const finite = row.tokens.filter(
            (token, index) =>
                index + 1 === predicate ||
                (token.head === predicate && /^(aux|cop)(:|$)/u.test(token.relation)),
        );
        for (const token of finite) {
            const word = token.text.toLowerCase();
            const replacement = {
                is: "are",
                are: "is",
                was: "were",
                were: "was",
                has: "have",
                have: "has",
            }[word];
            const expected = ["is", "was", "has"].includes(word) ? "Sing" : "Plur";
            if (!replacement || number !== expected || !token.features.includes("VerbForm=Fin"))
                continue;
            const changed = /^[A-Z]/u.test(token.text)
                ? replacement[0].toUpperCase() + replacement.slice(1)
                : replacement;
            return {
                id: `mutation:${row.id}`,
                sourceId: row.id,
                text: row.text.slice(0, token.start) + changed + row.text.slice(token.end),
                start: token.start,
                end: token.start + changed.length,
                cleanStart: token.start,
                cleanEnd: token.end,
                original: token.text,
                corrupted: changed,
                subject: subject.text,
                category: "agreement",
            };
        }
    }
    return undefined;
}
const mutations = fixture.cases.map(mutation).filter(Boolean);
const items = [
    ...fixture.cases.map((row) => ({ id: row.id, text: row.text, kind: "heldout" })),
    ...clean.map(([id, text]) => ({ id, text, kind: "clean" })),
    ...positives.map((item) => ({ ...item, kind: "positive" })),
    ...special,
    ...mutations.map((item) => ({ ...item, kind: "mutation" })),
];
if (process.argv.includes("--describe")) {
    console.log(
        JSON.stringify(
            {
                goldSentences: fixture.cases.length,
                controlledAgreementPairs: mutations.length,
                authoredClean: clean.length,
                authoredErrors: positives.length,
                special: special.length,
                totalWorkerAnalyses: items.length + fixture.cases.length,
            },
            null,
            2,
        ),
    );
    process.exit(0);
}

// Run the production worker, not a Python model or a fixture-backed mock.
const baseUrl = process.env.GENERALIZATION_BASE_URL ?? "http://127.0.0.1:4317";
let previewServer;
try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error("Production preview is unavailable.");
} catch (error) {
    if (process.env.GENERALIZATION_BASE_URL) throw error;
    previewServer = await preview({
        configFile: resolve("apps/web/vite.config.ts"),
        root: resolve("apps/web"),
        preview: { host: "127.0.0.1", port: 4317, strictPort: true },
    });
}
const browser = await chromium.launch();
let reports, rulesOnly, servedArtifacts;
try {
    const page = await browser.newPage();
    await page.goto(baseUrl);
    const worker = readdirSync("apps/web/dist/assets").find((name) =>
        /^analysis.worker-.*\.js$/u.test(name),
    );
    if (!worker) throw new Error("Build the application before running generalization evaluation.");
    ({ reports, rulesOnly, servedArtifacts } = await page.evaluate(
        async ({ worker, items }) => {
            const digest = async (bytes) =>
                [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
                    .map((byte) => byte.toString(16).padStart(2, "0"))
                    .join("");
            const registryResponse = await fetch(
                new URL("models/registry.json", document.baseURI),
                {
                    cache: "no-store",
                },
            );
            if (!registryResponse.ok) throw new Error("Served model registry is unavailable.");
            const registryBytes = await registryResponse.arrayBuffer();
            const registrySha256 = await digest(registryBytes);
            const registry = JSON.parse(new TextDecoder().decode(registryBytes));
            const resources = {};
            for (const [name, resource] of Object.entries(registry)) {
                if (!resource || typeof resource.path !== "string") continue;
                const response = await fetch(new URL(`models/${resource.path}`, document.baseURI), {
                    cache: "no-store",
                });
                if (!response.ok) throw new Error(`Served model resource is unavailable: ${name}`);
                const bytes = await response.arrayBuffer();
                const actual = await digest(bytes);
                if (actual !== resource.sha256)
                    throw new Error(`Served model registry hash mismatch: ${name}`);
                resources[name] = actual;
                if (["tagger", "parser", "classifier"].includes(name)) {
                    const manifest = JSON.parse(new TextDecoder().decode(bytes));
                    const weights = await fetch(
                        new URL(`models/weights/${manifest.artifact}`, document.baseURI),
                        { cache: "no-store" },
                    );
                    if (!weights.ok) throw new Error(`Served ${name} weights are unavailable.`);
                    const weightSha256 = await digest(await weights.arrayBuffer());
                    if (weightSha256 !== manifest.sha256)
                        throw new Error(`Served ${name} weight hash mismatch.`);
                    resources[`${name}Weights`] = weightSha256;
                }
            }
            const workerResponse = await fetch(new URL(`assets/${worker}`, document.baseURI), {
                cache: "no-store",
            });
            if (!workerResponse.ok) throw new Error("Served analysis worker is unavailable.");
            const workerSha256 = await digest(await workerResponse.arrayBuffer());
            const instance = new Worker(new URL(`assets/${worker}`, document.baseURI), {
                type: "module",
            });
            let id = 0;
            const analyze = (text, models) =>
                new Promise((resolve, reject) => {
                    const requestId = ++id;
                    const timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    `Generalization worker timed out on request ${requestId}`,
                                ),
                            ),
                        30_000,
                    );
                    instance.onmessage = (event) => {
                        if (event.data.id !== requestId) return;
                        clearTimeout(timer);
                        if (event.data.error) reject(new Error(event.data.error));
                        else resolve(event.data.report);
                    };
                    instance.onerror = (event) => {
                        clearTimeout(timer);
                        reject(new Error(event.message));
                    };
                    instance.postMessage({
                        id: requestId,
                        text,
                        revision: 0,
                        style: false,
                        models,
                        assetBase: new URL(".", document.baseURI).href,
                    });
                });
            try {
                const reports = [],
                    rulesOnly = [];
                for (const item of items) reports.push(await analyze(item.text, true));
                for (const item of items.filter((item) => item.kind === "heldout"))
                    rulesOnly.push(await analyze(item.text, false));
                return {
                    reports,
                    rulesOnly,
                    servedArtifacts: {
                        registryVersion: registry.version,
                        registrySha256,
                        resources,
                        worker,
                        workerSha256,
                    },
                };
            } finally {
                instance.terminate();
            }
        },
        { worker, items },
    ));
} finally {
    await browser.close();
    await new Promise((accept, reject) => {
        if (!previewServer) return accept();
        previewServer.httpServer.close((error) => (error ? reject(error) : accept()));
    });
}

function integrity(item, report) {
    const issues = [];
    let proposalsChecked = 0;
    if (report.text !== item.text) issues.push("Report changed source text");
    for (const sentence of report.sentences) {
        if (item.text.slice(sentence.start, sentence.end) !== sentence.text)
            issues.push("Sentence source span mismatch");
        for (const token of sentence.tokens)
            if (item.text.slice(token.start, token.end) !== token.text)
                issues.push("Token source span mismatch");
        const dependents = new Set();
        for (const edge of sentence.graph) {
            if (
                edge.head < 0 ||
                edge.head >= sentence.tokens.length ||
                edge.dependent < 0 ||
                edge.dependent >= sentence.tokens.length
            )
                issues.push("Dependency endpoint out of range");
            if (dependents.has(edge.dependent)) issues.push("Duplicate dependency parent");
            dependents.add(edge.dependent);
        }
        if (
            sentence.syntaxSource === "neural" &&
            (dependents.size !== sentence.tokens.length ||
                sentence.graph.filter((edge) => edge.relation === "root").length !== 1)
        )
            issues.push("Neural graph is not a single-root complete dependency graph");
        if (sentence.syntaxSource === "neural") {
            for (let index = 0; index < sentence.tokens.length; index++) {
                const visited = new Set();
                let current = index;
                while (!visited.has(current)) {
                    visited.add(current);
                    const edge = sentence.graph.find(
                        (candidate) => candidate.dependent === current,
                    );
                    if (!edge || edge.relation === "root") break;
                    current = edge.head;
                }
                const final = sentence.graph.find((candidate) => candidate.dependent === current);
                if (final && final.relation !== "root" && visited.has(current))
                    issues.push("Neural dependency cycle");
            }
        }
    }
    for (const diagnostic of report.diagnostics) {
        if (
            diagnostic.confidence?.calibrated === false &&
            diagnostic.confidence.probability !== undefined
        )
            issues.push("Uncalibrated classifier finding exposed a probability");
        if (
            diagnostic.start < 0 ||
            diagnostic.end < diagnostic.start ||
            diagnostic.end > item.text.length
        )
            issues.push("Diagnostic span out of range");
        for (const evidence of diagnostic.evidence)
            if (
                evidence.start < 0 ||
                evidence.end < evidence.start ||
                evidence.end > item.text.length
            )
                issues.push("Evidence span out of range");
        for (const proposal of diagnostic.proposals) {
            proposalsChecked++;
            const edits = [...proposal.edits].sort((a, b) => a.start - b.start);
            let cursor = 0,
                result = "",
                valid = true;
            for (const edit of edits) {
                if (
                    edit.start < cursor ||
                    edit.end < edit.start ||
                    edit.end > item.text.length ||
                    item.text.slice(edit.start, edit.end) !== edit.expected
                )
                    valid = false;
                result += item.text.slice(cursor, edit.start) + edit.replacement;
                cursor = edit.end;
            }
            result += item.text.slice(cursor);
            let applied = item.text;
            for (const edit of [...edits].reverse())
                applied = applied.slice(0, edit.start) + edit.replacement + applied.slice(edit.end);
            if (!valid || result !== applied)
                issues.push("Proposal did not apply with unchanged surrounding source");
        }
    }
    return { passed: !issues.length, issues: [...new Set(issues)], proposalsChecked };
}

function scoreSyntax(rows, outputs) {
    let total = 0,
        aligned = 0,
        posCorrect = 0,
        uasCorrect = 0,
        lasCorrect = 0,
        exactSentenceTokenizations = 0,
        neuralSentences = 0;
    let nonPunctTotal = 0,
        nonPunctPosCorrect = 0,
        nonPunctUasCorrect = 0,
        nonPunctLasCorrect = 0;
    const genres = new Map();
    const sourceGenre = (id) =>
        /^(answers|email|newsgroup|reviews|weblog)-/u.exec(id)?.[1] ?? "other";
    const cases = rows.map((row, rowIndex) => {
        const report = outputs[rowIndex];
        const genre = sourceGenre(row.id);
        const cohort = genres.get(genre) ?? {
            sentences: 0,
            goldTokens: 0,
            alignedNeuralTokens: 0,
            exactSentenceTokenizations: 0,
            posCorrect: 0,
            uasCorrect: 0,
            lasCorrect: 0,
        };
        cohort.sentences++;
        const predicted = report.sentences.flatMap((sentence) =>
            sentence.tokens.map((token, index) => ({ token, index, sentence })),
        );
        const bySpan = new Map(predicted.map((p) => [`${p.token.start}:${p.token.end}`, p]));
        if (
            predicted.length === row.tokens.length &&
            row.tokens.every((t) => bySpan.has(`${t.start}:${t.end}`))
        ) {
            exactSentenceTokenizations++;
            cohort.exactSentenceTokenizations++;
        }
        neuralSentences += report.sentences.filter((s) => s.syntaxSource === "neural").length;
        const errors = [];
        for (const [index, gold] of row.tokens.entries()) {
            total++;
            cohort.goldTokens++;
            const p = bySpan.get(`${gold.start}:${gold.end}`);
            const neural = p?.sentence.syntaxSource === "neural";
            if (neural) {
                aligned++;
                cohort.alignedNeuralTokens++;
            }
            const pos = neural && p.token.pos === gold.pos;
            const edge = neural && p.sentence.graph.find((e) => e.dependent === p.index);
            const headToken = edge ? p.sentence.tokens[edge.head] : undefined;
            const goldHead = row.tokens[gold.head - 1];
            const uas =
                !!edge &&
                (gold.head === 0
                    ? edge.relation === "root" && edge.head === edge.dependent
                    : !!goldHead &&
                      headToken.start === goldHead.start &&
                      headToken.end === goldHead.end &&
                      edge.relation !== "root");
            const las = uas && edge.relation === gold.relation;
            posCorrect += Number(pos);
            uasCorrect += Number(uas);
            lasCorrect += Number(las);
            cohort.posCorrect += Number(pos);
            cohort.uasCorrect += Number(uas);
            cohort.lasCorrect += Number(las);
            if (gold.pos !== "PUNCT") {
                nonPunctTotal++;
                nonPunctPosCorrect += Number(pos);
                nonPunctUasCorrect += Number(uas);
                nonPunctLasCorrect += Number(las);
            }
            if (!pos || !las)
                errors.push({
                    index,
                    text: gold.text,
                    goldPos: gold.pos,
                    predictedPos: p?.token.pos ?? null,
                    goldHead: gold.head,
                    predictedHeadSpan: headToken ? [headToken.start, headToken.end] : null,
                    goldRelation: gold.relation,
                    predictedRelation: edge?.relation ?? null,
                    neural: !!neural,
                });
        }
        genres.set(genre, cohort);
        return {
            id: row.id,
            goldTokens: row.tokens.length,
            predictedTokens: predicted.length,
            sentenceSources: report.sentences.map((s) => s.syntaxSource ?? "lexical"),
            errors: errors.slice(0, 8),
            errorsTruncated: Math.max(0, errors.length - 8),
        };
    });
    return {
        sentences: rows.length,
        totalGoldTokens: total,
        alignedNeuralTokens: aligned,
        exactSentenceTokenizations,
        neuralSentences,
        posAccuracyAllGold: posCorrect / total,
        uasAllGold: uasCorrect / total,
        lasAllGold: lasCorrect / total,
        posAccuracyAlignedNeural: aligned ? posCorrect / aligned : null,
        uasAlignedNeural: aligned ? uasCorrect / aligned : null,
        lasAlignedNeural: aligned ? lasCorrect / aligned : null,
        withoutPunctuation: {
            tokens: nonPunctTotal,
            posAccuracyAllGold: nonPunctPosCorrect / nonPunctTotal,
            uasAllGold: nonPunctUasCorrect / nonPunctTotal,
            lasAllGold: nonPunctLasCorrect / nonPunctTotal,
        },
        sourceGenreMethod:
            "Genre follows the official English Web Treebank sentence-ID prefix (answers, email, newsgroup, reviews, or weblog), documented by the pinned corpus README. Per-genre scores use every gold token in that family; tokenization mismatches and fallback tokens count as incorrect.",
        bySourceGenre: Object.fromEntries(
            [...genres.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([genre, score]) => [
                    genre,
                    {
                        sentences: score.sentences,
                        goldTokens: score.goldTokens,
                        alignedNeuralTokens: score.alignedNeuralTokens,
                        exactSentenceTokenizations: score.exactSentenceTokenizations,
                        posAccuracyAllGold: score.posCorrect / score.goldTokens,
                        uasAllGold: score.uasCorrect / score.goldTokens,
                        lasAllGold: score.lasCorrect / score.goldTokens,
                    },
                ]),
        ),
        method: "Exact original UTF-16 span alignment; unmatched or lexical-fallback tokens count as incorrect in all-gold metrics. Aligned-neural metrics condition on span matches and must be read with coverage. Basic UD exact relation labels; root self-loop decoded as gold head 0. No gold POS, heads, or features are sent to the worker.",
        cases,
    };
}

const byId = new Map(items.map((item, index) => [item.id, reports[index]]));
const brief = (report) =>
    report.diagnostics.map((d) => ({
        rule: d.ruleId,
        skill: d.skill,
        certainty: d.certainty,
        start: d.start,
        end: d.end,
        text: report.text.slice(d.start, d.end),
        proposals: d.proposals.map((p) =>
            p.edits.map((e) => ({ expected: e.expected, replacement: e.replacement })),
        ),
    }));
const authoredCases = items
    .filter((item) => item.kind !== "heldout" && item.kind !== "mutation")
    .map((item) => {
        const report = byId.get(item.id),
            diagnostics = brief(report);
        const conservative = report.diagnostics.filter(
            (d) => d.certainty !== "Possible issue" && d.certainty !== "Style suggestion",
        );
        const result = {
            id: item.id,
            kind: item.kind,
            text: item.text,
            modelState: report.modelStatus?.state ?? null,
            diagnostics,
            integrity: integrity(item, report),
            syntaxSources: report.sentences.map((s) => s.syntaxSource ?? "lexical"),
        };
        if (item.kind === "clean")
            Object.assign(result, {
                conservativeFalsePositive: conservative.length > 0,
                reviewWarning: report.diagnostics.length > 0,
            });
        if (item.kind === "positive") {
            const span = targetSpan(item);
            const findings = report.diagnostics.filter(
                (d) => d.skill === item.skill && d.start < span.end && d.end > span.start,
            );
            Object.assign(result, {
                expected: {
                    skill: item.skill,
                    ...span,
                    original: item.original,
                    replacement: item.replacement,
                    caveat: item.caveat,
                },
                detected: findings.length > 0,
                suggestedExpectedCorrection: findings.some((d) =>
                    d.proposals.some((p) =>
                        p.edits.some((e) => e.replacement === item.replacement),
                    ),
                ),
                predictedSyntax: report.sentences.map((sentence) => ({
                    syntaxSource: sentence.syntaxSource ?? "lexical",
                    ambiguous: sentence.ambiguous,
                    tokens: sentence.tokens.map((token) => ({
                        text: token.text,
                        pos: token.pos,
                        start: token.start,
                        end: token.end,
                        analyses: token.analyses,
                    })),
                    graph: sentence.graph,
                })),
            });
        }
        if (item.kind === "non-English")
            Object.assign(result, {
                abstainedFromCorrections: !report.diagnostics.some((d) => d.proposals.length),
                expectation: item.expectation,
            });
        if (item.kind === "ambiguous-case")
            Object.assign(result, {
                abstainedAsExpected:
                    report.sentences.some((sentence) => sentence.ambiguous) &&
                    !report.diagnostics.some((diagnostic) => diagnostic.proposals.length),
                expectation: item.expectation,
            });
        if (item.kind === "fragment" || item.kind === "long") result.expectation = item.expectation;
        return result;
    });
const confusion = () => ({ TP: 0, FP: 0, FN: 0, TN: 0 });
const classifier = confusion(),
    hybrid = confusion();
const mutationCases = mutations.map((item) => {
    const corrupt = byId.get(item.id),
        control = byId.get(item.sourceId);
    const atTarget = (report, start, end, modelOnly) =>
        report.diagnostics.some(
            (d) =>
                d.skill === "agreement" &&
                d.start < end &&
                d.end > start &&
                (!modelOnly || d.ruleId === "model-agreement"),
        );
    const modelHit = atTarget(corrupt, item.start, item.end, true),
        modelFalse = atTarget(control, item.cleanStart, item.cleanEnd, true);
    const hybridHit = atTarget(corrupt, item.start, item.end, false),
        hybridFalse = atTarget(control, item.cleanStart, item.cleanEnd, false);
    classifier[modelHit ? "TP" : "FN"]++;
    classifier[modelFalse ? "FP" : "TN"]++;
    hybrid[hybridHit ? "TP" : "FN"]++;
    hybrid[hybridFalse ? "FP" : "TN"]++;
    return {
        ...item,
        classifierHit: modelHit,
        classifierFalsePositiveOnControl: modelFalse,
        hybridHit,
        hybridFalsePositiveOnControl: hybridFalse,
        diagnostics: brief(corrupt),
        integrity: integrity(item, corrupt),
    };
});
const checks = items.map((item, i) => ({ id: item.id, ...integrity(item, reports[i]) }));
const natural = fixture.cases.map((row) => byId.get(row.id));
const positiveResults = authoredCases.filter((item) => item.kind === "positive");
const summaryBySkill = Object.fromEntries(
    [...new Set(positiveResults.map((item) => item.expected.skill))].map((skill) => {
        const cases = positiveResults.filter((item) => item.expected.skill === skill);
        return [
            skill,
            {
                cases: cases.length,
                detected: cases.filter((item) => item.detected).length,
                expectedCorrectionOffered: cases.filter((item) => item.suggestedExpectedCorrection)
                    .length,
            },
        ];
    }),
);
const report = {
    generatedAt: new Date().toISOString(),
    scope: "Production browser worker inference on fixed held-out natural syntax data plus newly authored development challenges and controlled gold-guided agreement mutations. Not an independent learner-essay accuracy or learning-effectiveness study. Model weights are not changed by this evaluation.",
    production: {
        baseUrl: process.env.GENERALIZATION_BASE_URL ?? "http://127.0.0.1:4317",
        analyzedCases: items.length,
        actualModelReady: reports.every((r) => r.modelStatus?.state === "ready"),
        modelStates: [...new Set(reports.map((r) => r.modelStatus?.state ?? "missing"))],
        versions: reports[0]?.versions,
        servedArtifacts,
        classifierConfidence: {
            calibratedReviewWarnings: reports
                .flatMap((report) => report.diagnostics)
                .filter((diagnostic) => diagnostic.confidence?.calibrated).length,
            uncalibratedReviewWarnings: reports
                .flatMap((report) => report.diagnostics)
                .filter((diagnostic) => diagnostic.confidence?.calibrated === false).length,
            policy: "A numeric synthetic-task probability is shown only for the ASCII tokenization-stable cohort with learned subject morphology used for calibration. Natural essay confidence remains unestablished.",
        },
    },
    fixture: {
        path: fixturePath,
        sha256: hash(readFileSync(fixturePath)),
        source: fixture.source,
        sourceCommit: fixture.sourceCommit,
        seed: fixture.seed,
        selection: fixture.selection,
        scope: fixture.scope,
    },
    naturalSyntax: scoreSyntax(fixture.cases, natural),
    learnedOutputEvidence: {
        sentencesDifferentFromRulesOnly: natural.filter(
            (report, i) =>
                JSON.stringify(
                    report.sentences.map((s) => ({
                        pos: s.tokens.map((t) => t.pos),
                        graph: s.graph,
                    })),
                ) !==
                JSON.stringify(
                    rulesOnly[i].sentences.map((s) => ({
                        pos: s.tokens.map((t) => t.pos),
                        graph: s.graph,
                    })),
                ),
        ).length,
        totalSentences: natural.length,
        note: "Difference from deterministic fallback demonstrates that the learned syntax path changes predictions; it alone does not prove better accuracy. Gold comparisons above measure correctness.",
        examples: natural.slice(0, 5).map((report, i) => ({
            id: fixture.cases[i].id,
            text: report.text,
            sentences: report.sentences.map((s) => ({
                source: s.syntaxSource,
                tokens: s.tokens.map((t) => ({
                    text: t.text,
                    pos: t.pos,
                    start: t.start,
                    end: t.end,
                })),
                graph: s.graph,
            })),
        })),
    },
    authoredChallenges: {
        scope: "New manually authored development probes across topics/constructions, not independently reviewed or representative of user essays. Clean/control judgments and positive target corrections are authored labels. Review warnings reported separately from conservative findings.",
        cleanCases: clean.length,
        cleanCasesWithConservativeFalsePositives: authoredCases.filter(
            (item) => item.kind === "clean" && item.conservativeFalsePositive,
        ).length,
        cleanCasesWithAnyReviewWarning: authoredCases.filter(
            (item) => item.kind === "clean" && item.reviewWarning,
        ).length,
        positiveCoverageBySkill: summaryBySkill,
        nonEnglishCasesWithCorrections: authoredCases.filter(
            (item) => item.kind === "non-English" && !item.abstainedFromCorrections,
        ).length,
        ambiguousCaseAbstentions: authoredCases.filter(
            (item) => item.kind === "ambiguous-case" && item.abstainedAsExpected,
        ).length,
        cases: authoredCases,
    },
    endToEndSyntheticAgreement: {
        scope: "Gold number/dependency/finite-verb annotations select one is/are/was/were/has/have number corruption per eligible held-out source sentence. The corrupted plain text alone is sent to the actual production tagger/parser/classifier. Natural source controls can already contain unrelated errors. Target-token binary detection only; no natural-essay precision claim and no oracle syntax is supplied at inference. Classifier-only counts use emitted model-agreement findings after production diagnostic resolution, not raw logits; a deterministic finding can suppress an overlapping model finding.",
        eligiblePairs: mutations.length,
        categories: { agreement: { classifierOnly: classifier, entireHybrid: hybrid } },
        cases: mutationCases,
    },
    sourceAndEditIntegrity: {
        passed: checks.every((check) => check.passed),
        cases: checks.length,
        proposalsChecked: checks.reduce((sum, check) => sum + check.proposalsChecked, 0),
        failures: checks.filter((check) => !check.passed),
    },
    failuresAreReportedWithoutSuppressingReport: true,
};
writeFileSync("reports/generalization.json", JSON.stringify(report, null, 4) + "\n");
console.log(
    JSON.stringify(
        {
            path: "reports/generalization.json",
            production: report.production,
            syntax: {
                POS: report.naturalSyntax.posAccuracyAllGold,
                UAS: report.naturalSyntax.uasAllGold,
                LAS: report.naturalSyntax.lasAllGold,
                aligned: report.naturalSyntax.alignedNeuralTokens,
                gold: report.naturalSyntax.totalGoldTokens,
            },
            authored: {
                cleanFalsePositives:
                    report.authoredChallenges.cleanCasesWithConservativeFalsePositives,
                cleanReviewWarnings: report.authoredChallenges.cleanCasesWithAnyReviewWarning,
                positiveCoverage: summaryBySkill,
                nonEnglishCorrections: report.authoredChallenges.nonEnglishCasesWithCorrections,
                ambiguousCaseAbstentions: report.authoredChallenges.ambiguousCaseAbstentions,
            },
            syntheticAgreement: report.endToEndSyntheticAgreement.categories,
            sourceAndEditIntegrity: report.sourceAndEditIntegrity,
        },
        null,
        2,
    ),
);
if (!report.production.actualModelReady || !report.sourceAndEditIntegrity.passed)
    process.exitCode = 1;
