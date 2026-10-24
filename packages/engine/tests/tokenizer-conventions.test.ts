import { describe, expect, it } from "vitest";
import { MorphologyAnalyzer, Tokenizer } from "../src/text";

describe("corpus-safe tokenization conventions", () => {
    const tokenizer = new Tokenizer();

    it.each([
        ["e-mail co-ordinator", ["e-mail", "co-ordinator"]],
        ["A. M. U.S. initials", ["A.", "M.", "U.S.", "initials"]],
        ["EY4106.6 E17 2scompany", ["EY4106.6", "E17", "2scompany"]],
        [
            "06/02/2001 10:53 01-Feb-02 9/11 1/2",
            ["06/02/2001", "10:53", "01-Feb-02", "9/11", "1/2"],
        ],
        ["1,993,045 August 11,2000", ["1,993,045", "August", "11", ",", "2000"]],
        [
            "https://example.org/a?q=1, x@y.example",
            ["https://example.org/a?q=1", ",", "x@y.example"],
        ],
        ["Wait... really!!! :)", ["Wait", "...", "really", "!!!", ":)"]],
    ])("keeps standard lexical and symbol groups: %s", (text, expected) => {
        const tokens = tokenizer.tokenize(text);
        expect(tokens.map((token) => token.text)).toEqual(expected);
        for (const token of tokens) expect(text.slice(token.start, token.end)).toBe(token.text);
    });

    it("continues to preserve English contraction spans", () => {
        expect(tokenizer.tokenize("doesn't we're O'Connor").map((token) => token.text)).toEqual([
            "does",
            "n't",
            "we",
            "'re",
            "O'Connor",
        ]);
    });

    it("uses the local training vocabulary for compound tokenization exceptions", () => {
        const trained = new Tokenizer(new MorphologyAnalyzer(), new Set(["e-mail"]));
        expect(trained.tokenize("e-mail 15-year company's").map((token) => token.text)).toEqual([
            "e-mail",
            "15",
            "-",
            "year",
            "company",
            "'s",
        ]);
    });
});
