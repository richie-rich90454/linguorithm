"""Controlled mutation labels must generalize without oracle classifier inputs."""

import unittest
from collections import Counter

from train_errors import LABELS, MutationParadigms, examples


def form(word, lemma, **features):
    return {
        "tokens": [word],
        "lemmas": [lemma],
        "tags": ["VERB"],
        "features": [features],
        "heads": [1],
        "relations": ["root"],
        "group": "training-document",
    }


def finite(word, lemma, number="Sing", tense="Pres", person="3"):
    return form(
        word,
        lemma,
        VerbForm="Fin",
        Mood="Ind",
        Number=number,
        Tense=tense,
        Person=person,
    )


def clause(verb="calibrates", lemma="calibrate", number="Sing"):
    return {
        "tokens": ["Instrument", verb],
        "lemmas": ["instrument", lemma],
        "tags": ["NOUN", "VERB"],
        "features": [
            {"Number": number},
            {
                "VerbForm": "Fin",
                "Mood": "Ind",
                "Tense": "Pres",
                "Number": number,
                "Person": "3",
            },
        ],
        "heads": [1, 2],
        "relations": ["nsubj", "root"],
        "group": "held-out-document",
    }


def perfect(participle="forsaken", lemma="forsake"):
    return {
        "tokens": ["They", "have", "already", participle],
        "lemmas": ["they", "have", "already", lemma],
        "tags": ["PRON", "AUX", "ADV", "VERB"],
        "features": [
            {"Person": "3", "Number": "Plur", "PronType": "Prs"},
            {
                "VerbForm": "Fin",
                "Mood": "Ind",
                "Tense": "Pres",
                "Number": "Plur",
                "Person": "3",
            },
            {},
            {"VerbForm": "Part", "Tense": "Past"},
        ],
        "heads": [3, 3, 3, 4],
        "relations": ["nsubj", "aux", "advmod", "root"],
        "group": "held-out-document",
    }


class MutationParadigmTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            finite("calibrates", "calibrate"),
            finite("calibrate", "calibrate", "Plur"),
            form("forsaken", "forsake", VerbForm="Part", Tense="Past"),
            finite("forsook", "forsake", tense="Past"),
        ]
        self.paradigms = MutationParadigms(self.rows)

    def test_attested_lexical_agreement_in_both_directions(self):
        self.assertEqual(self.paradigms.agreement(clause(), 1, 0), "calibrate")
        self.assertEqual(
            self.paradigms.agreement(clause("calibrate", number="Plur"), 1, 0),
            "calibrates",
        )

    def test_unseen_lemma_has_no_guessed_suffix(self):
        self.assertIsNone(self.paradigms.agreement(clause("oxidizes", "oxidize"), 1, 0))

    def test_competing_attested_target_spellings_abstain(self):
        index = MutationParadigms(
            self.rows + [finite("calibrateth", "calibrate", "Plur")]
        )
        self.assertIsNone(index.agreement(clause(), 1, 0))

    def test_syncretic_agreement_cannot_create_an_error(self):
        index = MutationParadigms([finite("put", "put"), finite("put", "put", "Plur")])
        self.assertIsNone(index.agreement(clause("put", "put"), 1, 0))

    def test_non_third_person_and_subjunctive_are_excluded(self):
        row = clause()
        row["features"][0]["Person"] = "1"
        self.assertIsNone(self.paradigms.agreement(row, 1, 0))
        row = clause()
        row["features"][1]["Mood"] = "Sub"
        self.assertIsNone(self.paradigms.agreement(row, 1, 0))

    def test_case_is_preserved(self):
        self.assertEqual(
            self.paradigms.agreement(clause("CALIBRATES"), 1, 0), "CALIBRATE"
        )

    def test_past_participle_is_derived_with_intervening_adverb(self):
        self.assertEqual(self.paradigms.verb_form(perfect(), 3), "forsook")

    def test_non_perfect_auxiliary_is_excluded(self):
        row = perfect()
        row["lemmas"][1] = "be"
        self.assertIsNone(self.paradigms.verb_form(row, 3))

    def test_syncretic_past_participle_is_excluded(self):
        index = MutationParadigms(
            [
                form("walked", "walk", VerbForm="Part", Tense="Past"),
                finite("walked", "walk", tense="Past"),
            ]
        )
        self.assertIsNone(index.verb_form(perfect("walked", "walk"), 3))

    def test_predicted_inputs_do_not_contain_gold_morphology_or_tags(self):
        class Predictor:
            def __init__(self):
                self.statistics = Counter()
                self.sequences = []

            def extract(self, tokens):
                self.sequences.append(list(tokens))
                # Deliberately disagree with every gold input to detect leakage.
                return [([9] * 7, [2] * 7, [0.125] * 6) for _ in tokens]

        predictor = Predictor()
        output = examples([clause(), perfect()], {}, {}, predictor, self.paradigms)
        self.assertTrue(any(row[3] == LABELS.index("agreement") for row in output))
        self.assertTrue(any(row[3] == LABELS.index("verb-form") for row in output))
        self.assertTrue(
            all(row[:3] == ([9] * 7, [2] * 7, [0.125] * 6) for row in output)
        )
        self.assertIn(["Instrument", "calibrate"], predictor.sequences)
        self.assertIn(["They", "have", "already", "forsook"], predictor.sequences)


if __name__ == "__main__":
    unittest.main()
