"""Read written OANC primary text from its ZIP without extracting the corpus."""

import re
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile

from ingest_oanc import read_manifest

TOKEN = re.compile(r"[^\W_]+(?:['’][^\W_]+)*(?:\.[^\W_]+)*|[^\w\s]", re.UNICODE)
TERMINAL = {".", "?", "!", "…"}
ABBREVIATIONS = {
    "a.m",
    "adm",
    "approx",
    "assn",
    "ave",
    "bros",
    "co",
    "corp",
    "dept",
    "dr",
    "e.g",
    "etc",
    "fig",
    "i.e",
    "inc",
    "jr",
    "mr",
    "mrs",
    "ms",
    "no",
    "p.m",
    "prof",
    "rev",
    "sr",
    "st",
    "u.s",
    "u.k",
    "vs",
}
TITLES = {"dr", "mr", "mrs", "ms", "prof", "rev", "sr", "jr", "st"}


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data)


def plain_text(raw):
    parser = TextExtractor()
    parser.feed(raw.decode("utf-8-sig", errors="replace"))
    parser.close()
    return " ".join(parser.parts)


def split_sentences(text):
    sentence, tokens = [], TOKEN.findall(text)
    for index, token in enumerate(tokens):
        sentence.append(token)
        if token in TERMINAL:
            if index + 1 < len(tokens) and tokens[index + 1] == token:
                continue
            previous = sentence[-2].lower() if len(sentence) > 1 else ""
            if token == "." and previous in ABBREVIATIONS:
                next_token = tokens[index + 1] if index + 1 < len(tokens) else ""
                next_word = next_token[:1].isupper()
                if previous in TITLES or not next_word:
                    continue
            yield sentence
            sentence = []
    if sentence:
        yield sentence


def iter_written_sentences(archive_path, manifest=None):
    """Yield deterministic (document-path, tokenized-sentence) pairs."""
    manifest = manifest or read_manifest()
    archive_path = Path(archive_path)
    with ZipFile(archive_path) as archive:
        names = sorted(
            name
            for name in archive.namelist()
            if name.lower().endswith(".txt")
            and name.startswith("OANC-GrAF/data/")
            and name.split("/", 3)[2] in manifest["selectedCollections"]
        )
        if len(names) != manifest["selectedDocuments"]:
            raise ValueError(
                "OANC written-document inventory changed: "
                f"expected {manifest['selectedDocuments']}, got {len(names)}"
            )
        for name in names:
            info = archive.getinfo(name)
            if info.file_size > 64 * 1024 * 1024:
                raise ValueError(
                    f"OANC document exceeds the 64 MiB safety limit: {name}"
                )
            text = plain_text(archive.read(name))
            for sentence in split_sentences(text):
                if sentence:
                    yield name, sentence
