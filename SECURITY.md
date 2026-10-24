# Security policy

Review currently focuses on the current development revision. There is no published supported-release schedule or guaranteed response time.

## Reporting

If GitHub private vulnerability reporting is enabled, use **Security → Report a vulnerability**. Otherwise open a minimal issue asking the maintainer for a private reporting channel. Do not post exploit payloads, private documents, credentials, or student data publicly. No dedicated security email address is currently published.

Include the revision, browser/OS, a synthetic reproduction, expected boundary, actual result, and likely impact. Relevant areas include unsafe document rendering, archive/import limits, backup validation, resource integrity bypasses, unexpected network requests, and access to learning records.

## Privacy boundaries

Linguorithm stores writing and records in the browser. Local-first operation cannot protect against a compromised device, malicious extension, or exposed exported backup. Redact private data before sharing traces, screenshots, or reports. Model findings are not correctness or security certificates.

Please coordinate disclosure so a fix and affected-user guidance can be prepared. Maintainers should acknowledge reports, establish a private reproduction, and communicate remediation status without exposing sensitive details prematurely.
