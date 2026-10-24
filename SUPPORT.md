# Support

Start with the [quickstart](docs/quickstart.md) for setup and the [model card](docs/model-card.md) for analysis behavior. [Release status](docs/release-status.md) and [verification](reports/verification.md) explain what has been measured and what remains unvalidated.

Use this repository's Issues page for reproducible bugs and feature proposals. Include the revision, browser/OS, command, minimal synthetic example, expected behavior, and actual result. There is no guaranteed response time.

Choose **Bug report** for setup failures, crashes, broken imports, or other application behavior; **Grammar or practice feedback** for a questionable finding, missing correction, or ambiguous answer; and **Feature proposal** for a new workflow. Search existing issues first and add useful reproduction details to an existing report when it describes the same problem.

For an incorrect grammar finding, include a short invented sentence, highlighted span, model/fallback status, and why the analysis is questionable. Explain the intended interpretation when multiple analyses are possible. A suggestion or clean report cannot certify correctness.

Run commands from the repository root and include useful error text. Missing dependencies need an explicit setup target; missing packaged models can be restored with `make models`. Do not reinstall globally.

Never upload essays, student records, backups, private source documents, or unredacted browser traces. Report vulnerabilities through the [security process](SECURITY.md).
