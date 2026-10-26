import { describe, expect, it } from "vitest";
import { editDistance, SpellingIndex } from "../src/spelling";

describe("full dictionary spelling retrieval", () => {
    it("splits a merged token only at one corpus-supported word boundary", () => {
        const index = new SpellingIndex(
            [
                "a",
                "lot",
                "we",
                "should",
                "of",
                "the",
                "account",
                "all",
                "life",
                "world",
                "therapist",
                "rapist",
                "for",
                "ex",
            ],
            {
                a: 3776,
                lot: 93,
                we: 919,
                should: 244,
                of: 3616,
                the: 9066,
                account: 14,
                all: 519,
                life: 80,
                world: 137,
                therapist: 47,
                rapist: 3,
                for: 755,
                ex: 11,
            },
            2,
        );
        expect(index.splitConcatenated("alot")).toBe("a lot");
        expect(index.splitConcatenated("weshould")).toBe("we should");
        expect(index.splitConcatenated("ofthe")).toBe("of the");
        expect(index.splitConcatenated("accountall")).toBe("account all");
        expect(index.splitConcatenated("lifeworld")).toBeUndefined();
        expect(index.splitConcatenated("therapist")).toBeUndefined();
        expect(index.splitConcatenated("forex")).toBeUndefined();
        expect(index.splitConcatenated("the")).toBeUndefined();
        expect(index.splitConcatenated("weshouldnow")).toBeUndefined();
    });

    it("retrieves approved terms missing from the training-frequency shortlist", () => {
        const index = new SpellingIndex(
            ["the", "quaternion", "spectrophotometer", "oxidization"],
            { the: 100, quaternion: 1 },
            2,
        );
        expect(index.candidates("quaterinon")).toContain("quaternion");
        expect(index.candidates("spectrophotomter")).toContain("spectrophotometer");
        expect(index.candidates("oxidizaton")).toContain("oxidization");
    });

    it("preserves the existing common-word prior and does not mix in rare alternatives", () => {
        const index = new SpellingIndex(
            ["cart", "cast", "cant", "coat"],
            { cart: 30, cast: 50 },
            2,
        );
        expect(index.candidates("caat")).toEqual(["cast", "cart"]);
    });

    it("uses exact Damerau distance for transposition plus insertion and Unicode characters", () => {
        const index = new SpellingIndex(["abcde", "café", "a𐐨bcde", "the"], { the: 10 }, 2);
        expect(editDistance("cade", "abcde")).toBe(2);
        expect(index.candidates("cade")).toContain("abcde");
        expect(index.candidates("cafe")).toContain("café");
        expect(editDistance("a𐐀bcde", "ab𐐀cde")).toBe(1);
        expect(index.candidates("ab𐐨cde")).toContain("a𐐨bcde");
    });

    it("keeps recognition, output caps, and conservative query limits", () => {
        const index = new SpellingIndex(
            ["quaternion", "abcd", "abce", "abcf", "abcg"],
            { the: 10 },
            2,
        );
        expect(index.has("QUATERNION")).toBe(true);
        expect(index.candidates("quaternion")).toEqual([]);
        expect(index.candidates("abch")).toHaveLength(3);
        expect(index.candidates("abc")).toEqual([]);
        expect(index.candidates("x".repeat(41))).toEqual([]);
        expect(index.candidates("zebra")).toEqual([]);
    });

    it("agrees with exhaustive distance ranking on a small complete vocabulary", () => {
        const words = Array.from({ length: 81 }, (_, value) =>
            value
                .toString(3)
                .padStart(4, "0")
                .replace(/[012]/gu, (digit) => "abc"[Number(digit)]!),
        );
        const index = new SpellingIndex(words, { the: 10 }, 2);
        for (const input of ["abaca", "bacab", "ccabc", "aaxca", "bcxca", "xcabc", "cabx"]) {
            const expected = words
                .filter((word) => editDistance(input, word) <= 2)
                .sort(
                    (a, b) => editDistance(input, a) - editDistance(input, b) || a.localeCompare(b),
                )
                .slice(0, 3);
            expect(index.candidates(input)).toEqual(expected);
        }
    });
});
