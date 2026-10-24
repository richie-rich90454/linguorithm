import { describe, expect, it } from "vitest";
import type { Morphology, Token } from "../src/domain";
import { PastParticipleInflections, PresentVerbInflections } from "../src/inflections";

const finite = (lemma: string, number: "singular" | "plural"): Morphology => ({
    lemma,
    pos: "VERB",
    number,
    finite: true,
    verbForm: "Fin",
    tense: "Pres",
});
const infinitive = (lemma: string): Morphology => ({
    lemma,
    pos: "VERB",
    finite: false,
    verbForm: "Inf",
    tense: "",
});

describe("observed past-participle inflections", () => {
    const past = (lemma: string): Morphology => ({
        lemma,
        pos: "VERB",
        finite: true,
        verbForm: "Fin",
        tense: "Past",
    });
    const participle = (lemma: string): Morphology => ({
        lemma,
        pos: "VERB",
        finite: false,
        verbForm: "Part",
        tense: "Past",
    });
    const observed: Record<string, Morphology[]> = {
        choose: [infinitive("choose"), finite("choose", "plural")],
        chose: [past("choose")],
        chosen: [participle("choose")],
        drive: [infinitive("drive"), { lemma: "drive", pos: "NOUN" }],
        drove: [past("drive")],
        driven: [participle("drive")],
        forsake: [infinitive("forsake")],
        forsook: [past("forsake")],
        forsaken: [participle("forsake")],
    };

    it("retrieves learned irregular paradigms from past, infinitive, or present sources", () => {
        const index = new PastParticipleInflections(observed);
        for (const [source, target] of [
            ["choose", "chosen"],
            ["chose", "chosen"],
            ["drive", "driven"],
            ["drove", "driven"],
            ["forsake", "forsaken"],
            ["forsook", "forsaken"],
        ])
            expect(index.candidate(token(source!, observed[source!]!))).toBe(target);
        expect(index.candidate(token("Chose", observed.chose))).toBe("Chosen");
        expect(index.candidate(token("DROVE", observed.drove))).toBe("DRIVEN");
    });

    it("abstains when the source already permits a past-participle reading", () => {
        const ambiguous: Record<string, Morphology[]> = {
            ...observed,
            cut: [infinitive("cut"), past("cut"), participle("cut")],
            read: [infinitive("read"), past("read"), participle("read")],
        };
        const index = new PastParticipleInflections(ambiguous);
        for (const source of ["chosen", "driven", "cut", "read"])
            expect(index.candidate(token(source, ambiguous[source]!))).toBeUndefined();
        expect(index.candidate(token("chose", [participle("choose")]))).toBeUndefined();
    });

    it("requires an attested unique target and consistent source lemma", () => {
        const cases: Record<string, Morphology[]>[] = [
            { ...observed, chosen: [] },
            { ...observed, chosen: [participle("other")] },
            {
                ...observed,
                chosen: [participle("choose"), { lemma: "other", pos: "NOUN" as const }],
            },
            { ...observed, choosen: [participle("choose")] },
            { ...observed, chose: [past("choose"), past("other")] },
            { ...observed, chose: [{ ...past("choose"), pos: "AUX" as const }] },
        ];
        for (const modified of cases)
            expect(
                new PastParticipleInflections(modified).candidate(token("chose", modified.chose)),
            ).toBeUndefined();
        const index = new PastParticipleInflections(observed);
        expect(index.candidate(token("chose", []))).toBeUndefined();
        expect(index.candidate(token("unseen", [past("choose")]))).toBeUndefined();
        expect(index.candidate({ ...token("chose", observed.chose), pos: "NOUN" })).toBeUndefined();
        expect(index.candidate(token("chose", [past("other")]))).toBeUndefined();
    });
});
const forms: Record<string, Morphology[]> = {
    calibrates: [finite("calibrate", "singular")],
    calibrate: [finite("calibrate", "plural"), infinitive("calibrate")],
    oxidizes: [finite("oxidize", "singular")],
    oxidize: [finite("oxidize", "plural"), infinitive("oxidize")],
};
function token(text: string, analyses = forms[text.toLowerCase()] ?? []): Token {
    return { text, start: 0, end: text.length, pos: "VERB", analyses };
}

describe("observed present-tense inflections", () => {
    it("generalizes to supplied verb paradigms without a built-in pair list", () => {
        const index = new PresentVerbInflections(forms);
        expect(index.candidate(token("calibrates"), "plural")).toBe("calibrate");
        expect(index.candidate(token("oxidizes"), "plural")).toBe("oxidize");
        expect(index.candidate(token("Calibrates"), "plural")).toBe("Calibrate");
        expect(index.candidate(token("OXIDIZES"), "plural")).toBe("OXIDIZE");
        expect(index.candidate(token("calibrates"), "singular")).toBeUndefined();
        expect(index.candidate(token("teleports"), "plural")).toBeUndefined();
    });

    it("resolves a common infinitive alternative only with parsed finite context", () => {
        expect(
            new PresentVerbInflections(forms).candidate(token("calibrate"), "singular"),
        ).toBeUndefined();
        expect(
            new PresentVerbInflections(forms).candidate(token("calibrate"), "singular", true),
        ).toBe("calibrates");
        expect(
            new PresentVerbInflections(forms).candidate(token("CALIBRATE"), "singular", true),
        ).toBe("CALIBRATES");
        const unambiguous = { ...forms, calibrate: [finite("calibrate", "plural")] };
        expect(
            new PresentVerbInflections(unambiguous).candidate(
                token("calibrate", unambiguous.calibrate),
                "singular",
            ),
        ).toBe("calibrates");
    });

    it("still rejects a base form with a conflicting tense even in parsed context", () => {
        const conflicting = {
            ...forms,
            calibrate: [...forms.calibrate!, { ...finite("calibrate", "singular"), tense: "Past" }],
        };
        expect(
            new PresentVerbInflections(conflicting).candidate(
                token("calibrate", conflicting.calibrate),
                "singular",
                true,
            ),
        ).toBeUndefined();
    });

    it("generalizes regular verb classes only with a finite parse and dictionary-confirmed forms", () => {
        const words = new Set([
            "scrutinize",
            "scrutinizes",
            "study",
            "studies",
            "watch",
            "watches",
            "play",
            "plays",
            "read",
            "reads",
        ]);
        const index = new PresentVerbInflections({}, (word) => words.has(word));
        const withLemma = (text: string, lemma: string): Token =>
            token(text, [{ lemma, pos: "VERB" }]);
        expect(index.candidate(withLemma("scrutinize", "scrutinize"), "singular", true)).toBe(
            "scrutinizes",
        );
        expect(index.candidate(withLemma("study", "study"), "singular", true)).toBe("studies");
        expect(index.candidate(withLemma("watch", "watch"), "singular", true)).toBe("watches");
        expect(index.candidate(withLemma("play", "play"), "singular", true)).toBe("plays");
        expect(index.candidate(withLemma("STUDY", "study"), "singular", true)).toBe("STUDIES");
        expect(index.candidate(withLemma("studies", "study"), "plural", true)).toBe("study");
        expect(index.candidate(withLemma("study", "study"), "singular")).toBeUndefined();
        expect(
            new PresentVerbInflections({}, () => false).candidate(
                withLemma("study", "study"),
                "singular",
                true,
            ),
        ).toBeUndefined();
        expect(index.candidate(withLemma("read", "read"), "singular", true)).toBe("reads");
        const past = new PresentVerbInflections(
            {
                read: [
                    { lemma: "read", pos: "VERB", finite: true, verbForm: "Fin", tense: "Past" },
                ],
            },
            (word) => words.has(word),
        );
        expect(
            past.candidate(
                token("read", [
                    { lemma: "read", pos: "VERB", finite: true, verbForm: "Fin", tense: "Past" },
                ]),
                "singular",
                true,
            ),
        ).toBeUndefined();
    });

    it("rejects mixed tense, nonfinite, missing morphology, and inconsistent model analyses", () => {
        for (const alternative of [
            { ...finite("calibrate", "singular"), tense: "Past" },
            { ...finite("calibrate", "singular"), tense: "" },
            infinitive("calibrate"),
            finite("calibration", "singular"),
        ]) {
            const mixed = { ...forms, calibrates: [...forms.calibrates!, alternative] };
            expect(
                new PresentVerbInflections(mixed).candidate(token("calibrates"), "plural"),
            ).toBeUndefined();
        }
        const index = new PresentVerbInflections(forms);
        expect(index.candidate(token("calibrates", []), "plural")).toBeUndefined();
        expect(
            index.candidate(token("calibrates", [finite("invented", "singular")]), "plural"),
        ).toBeUndefined();
        expect(index.candidate({ ...token("calibrates"), pos: "NOUN" }, "plural")).toBeUndefined();
    });

    it("requires a unique same-lemma target with attested target number and tense", () => {
        for (const target of [
            [finite("unrelated", "plural")],
            [{ ...finite("calibrate", "plural"), tense: "Past" }],
            [{ ...finite("calibrate", "plural"), number: undefined }],
            [finite("calibrate", "plural"), finite("unrelated", "plural")],
        ]) {
            expect(
                new PresentVerbInflections({ ...forms, calibrate: target }).candidate(
                    token("calibrates"),
                    "plural",
                ),
            ).toBeUndefined();
        }
        expect(
            new PresentVerbInflections({
                ...forms,
                calibrateth: [finite("calibrate", "plural")],
            }).candidate(token("calibrates"), "plural"),
        ).toBeUndefined();
    });

    it("excludes be, auxiliary analyses, and singular base forms without person metadata", () => {
        const restricted = {
            is: [finite("be", "singular")],
            are: [finite("be", "plural")],
            has: [{ ...finite("have", "singular"), pos: "AUX" as const }],
            have: [finite("have", "plural")],
            calibrates: forms.calibrates!,
            calibrate: [finite("calibrate", "singular")],
        };
        const index = new PresentVerbInflections(restricted);
        expect(index.candidate(token("is", restricted.is), "plural")).toBeUndefined();
        expect(index.candidate(token("has", restricted.has), "plural")).toBeUndefined();
        expect(index.candidate(token("calibrates"), "plural")).toBeUndefined();
    });

    it("honors person metadata and rejects unrelated nominal lemmas", () => {
        const indexed = {
            ...forms,
            calibrates: [{ ...finite("calibrate", "singular"), person: 3 as const }],
            calibrate: [
                { ...finite("calibrate", "singular"), person: 1 as const },
                finite("calibrate", "plural"),
                infinitive("calibrate"),
            ],
        };
        const index = new PresentVerbInflections(indexed);
        expect(index.candidate(token("calibrates", indexed.calibrates), "plural")).toBe(
            "calibrate",
        );
        expect(index.candidate(token("calibrate", indexed.calibrate), "singular")).toBeUndefined();
        const ambiguous = {
            ...forms,
            calibrate: [...forms.calibrate!, { lemma: "calibration", pos: "NOUN" as const }],
        };
        expect(
            new PresentVerbInflections(ambiguous).candidate(token("calibrates"), "plural"),
        ).toBeUndefined();
    });
});
