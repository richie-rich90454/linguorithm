"""Score the candidate syntax models on pinned, source-held-out English UD tests."""

import json
import time

import numpy as np
import onnxruntime as ort
import torch
from ewt_splits import verified_splits
from train_release import (
    CRF,
    ROOT,
    TAGS,
    Tagger,
    decode,
    encode,
    parse,
    read_corpus,
    write_json,
)
from training_stats import wilson_interval
from ud_english_sources import load_evaluation_rows, load_training_rows


def main():
    out = ROOT / "models/generated/ewt-1"
    checkpoint = torch.load(out / "tagger.pt", map_location="cpu", weights_only=False)
    metadata = checkpoint["metadata"]
    model, crf = Tagger(len(metadata["vocabulary"]), len(metadata["characters"])), CRF()
    model.load_state_dict(checkpoint["model"])
    crf.load_state_dict(checkpoint["crf"])
    model.eval()
    tagger_manifest = json.loads(
        (out / "tagger-manifest.json").read_text(encoding="utf-8")
    )
    parser_manifest = json.loads(
        (out / "parser-manifest.json").read_text(encoding="utf-8")
    )
    parser_options = ort.SessionOptions()
    parser_options.intra_op_num_threads = 1
    parser_session = ort.InferenceSession(
        str(out / "parser.onnx"), parser_options, providers=["CPUExecutionProvider"]
    )
    ewt_splits, _ = verified_splits(ROOT, read_corpus)
    training_rows, _ = load_training_rows(ROOT, read_corpus)
    training_sentence_count = len(training_rows) + len(ewt_splits["train"])
    known_training_sentences = {tuple(row["tokens"]) for row in training_rows}
    known_training_sentences.update(tuple(row["tokens"]) for row in ewt_splits["train"])
    sources = load_evaluation_rows(ROOT, read_corpus)
    evaluations, excluded_overlap = {}, {}
    seen_test_sentences = set()
    total_tokens = total_pos = total_uas = total_las = 0
    for source_id, entry in sources.items():
        original = entry["rows"]
        rows = []
        overlap = 0
        for row in original:
            key = tuple(row["tokens"])
            if key in known_training_sentences or key in seen_test_sentences:
                overlap += 1
                continue
            rows.append(row)
            seen_test_sentences.add(key)
        excluded_overlap[source_id] = overlap
        if not rows:
            evaluations[source_id] = {
                "status": "no-disjoint-sentences",
                "sentences": 0,
                "overlapSentencesExcluded": overlap,
                "license": entry["license"],
                "domain": entry["domain"],
                "sha256": entry["sha256"],
            }
            continue
        correct_pos = 0
        token_count = uas = las = 0
        started = time.perf_counter()
        for row in rows:
            words, chars, lengths, _ = encode(
                [row], metadata["vocabulary"], metadata["characters"]
            )
            with torch.no_grad():
                emissions = model(words, chars, lengths).numpy()[0]
            predicted = [
                TAGS[index]
                for index in decode(
                    emissions[: len(row["tokens"])],
                    np.asarray(tagger_manifest["transitions"], dtype=np.float32),
                    np.asarray(tagger_manifest["startScores"], dtype=np.float32),
                    np.asarray(tagger_manifest["endScores"], dtype=np.float32),
                )
            ]
            row["predictedTags"] = predicted
            correct_pos += sum(
                predicted_tag == gold_tag
                for predicted_tag, gold_tag in zip(predicted, row["tags"], strict=True)
            )
            state = parse(
                parser_session,
                row,
                metadata["vocabulary"],
                parser_manifest["actions"],
            )
            for predicted_head, predicted_relation, gold_head, gold_relation in zip(
                state[2], state[3], row["heads"], row["relations"], strict=True
            ):
                uas += predicted_head == gold_head
                las += (
                    predicted_head == gold_head and predicted_relation == gold_relation
                )
                token_count += 1
        source_metrics = {
            "status": "scored",
            "sentences": len(rows),
            "tokens": token_count,
            "posAccuracy": correct_pos / token_count,
            "posAccuracy95PercentCI": wilson_interval(correct_pos, token_count),
            "uas": uas / token_count,
            "uas95PercentCI": wilson_interval(uas, token_count),
            "las": las / token_count,
            "las95PercentCI": wilson_interval(las, token_count),
            "overlapSentencesExcluded": overlap,
            "license": entry["license"],
            "domain": entry["domain"],
            "sha256": entry["sha256"],
            "seconds": round(time.perf_counter() - started, 3),
        }
        evaluations[source_id] = source_metrics
        total_tokens += token_count
        total_pos += correct_pos
        total_uas += uas
        total_las += las
        print(json.dumps({"source": source_id, **source_metrics}), flush=True)
    report = {
        "schemaVersion": 1,
        "scope": (
            "Pinned official test splits from English UD treebanks excluded from model fitting. "
            "Three corresponding training splits (Atis, CHILDES, ESLSpok) contribute to the expanded "
            "candidate, so the aggregate is split-held-out, not source-held-out; only CTeTex, "
            "LittlePrince, PUD, and Pronouns are fully source-held-out. The aggregate is dominated "
            "by CHILDES. Evaluation uses gold tokens and reports tagger/parser component scores, not "
            "browser tokenization or grammar-error detection. Source domains include spoken transcripts "
            "and targeted examples; results are not learner-writing validation."
        ),
        "selection": "Candidate checkpoints were selected on EWT validation only; these source tests were not used for tuning.",
        "trainingSentenceOverlapExcluded": True,
        "testSentenceOverlapPolicy": "Exact token-sequence duplicates are counted once in manifest order and reported as excluded.",
        "intervalMethod": "Two-sided 95% token-level Wilson intervals; sentence clustering and between-document sampling uncertainty are not modeled, so intervals are descriptive only.",
        "trainingSentences": training_sentence_count,
        "evaluationSources": len(sources),
        "aggregate": {
            "tokens": total_tokens,
            "posAccuracy": total_pos / total_tokens if total_tokens else None,
            "posAccuracy95PercentCI": wilson_interval(total_pos, total_tokens),
            "uas": total_uas / total_tokens if total_tokens else None,
            "uas95PercentCI": wilson_interval(total_uas, total_tokens),
            "las": total_las / total_tokens if total_tokens else None,
            "las95PercentCI": wilson_interval(total_las, total_tokens),
        },
        "overlapSentencesExcluded": excluded_overlap,
        "sources": evaluations,
    }
    write_json(ROOT / "reports/secondary-ud-evaluation.json", report)
    print(json.dumps({"event": "complete", **report["aggregate"]}), flush=True)


if __name__ == "__main__":
    main()
