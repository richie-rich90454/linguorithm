# Open American National Corpus provenance

Linguorithm's contextual correction ranker uses local word and bigram counts derived from the OANC GrAF release dated 25 September 2026. It reads only primary text in `written_1` and `written_2` (6,424 documents) directly from the archive. The spoken collection is excluded. The text is used for contextual ranking, not as gold syntax or learner-error labels.

The American National Corpus publisher describes OANC as unrestricted for use and redistribution, including commercial development: <https://anc.org/data/oanc/> and <https://anc.org/data/oanc/download/>. The exact release URL, archive SHA-256, selected collections, and processing limits are recorded in [`oanc-manifest.json`](oanc-manifest.json).

## Citation

Ide, Nancy and Suderman, Keith. Open American National Corpus. American National Corpus Project, OANC GrAF release dated 25 September 2026. <https://anc.org/data/oanc/>.
