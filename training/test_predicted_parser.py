"""The transition parser must train on the POS tags it receives at runtime."""

import unittest

from train_release import TAGS, oracle


class PredictedParserTests(unittest.TestCase):
    def test_oracle_states_can_use_frozen_tagger_predictions(self):
        row = {
            "tokens": ["writers", "work"],
            "tags": ["NOUN", "VERB"],
            "predictedTags": ["PROPN", "NOUN"],
            "heads": [1, 2],
            "relations": ["nsubj", "root"],
        }
        vocabulary = {"<pad>": 0, "<unk>": 1, "<root>": 2}

        states = oracle(row, vocabulary, predicted=True)

        self.assertTrue(states)
        first_tag_window = states[0][1]
        self.assertEqual(first_tag_window[3], TAGS.index("PROPN") + 2)
        self.assertEqual(first_tag_window[4], TAGS.index("NOUN") + 2)

    def test_oracle_keeps_gold_pos_available_for_reference_tests(self):
        row = {
            "tokens": ["writers", "work"],
            "tags": ["NOUN", "VERB"],
            "predictedTags": ["PROPN", "NOUN"],
            "heads": [1, 2],
            "relations": ["nsubj", "root"],
        }

        states = oracle(row, {"<pad>": 0, "<unk>": 1, "<root>": 2})

        self.assertEqual(states[0][1][3], TAGS.index("NOUN") + 2)


if __name__ == "__main__":
    unittest.main()
