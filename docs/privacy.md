# Privacy

## Verifiable offline posture

Linguorithm ships as static files. Analysis, practice, and storage happen in the browser. There is no account, no server-side essay processing, and no upload path for a document.

- No account, sign-in, or user identifier.
- No telemetry, analytics, error reporting, or crash upload.
- No remote fonts, CDNs, or third-party scripts.
- No network request after first load; the built app reloads with the network disabled.

This is enforced, not asserted: the release check fails if any external host appears in the request log. See [how CI proves it](#how-ci-proves-it).

## Content Security Policy

The production build injects this meta CSP:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'
```

`connect-src 'self'` permits same-origin requests only. `font-src 'self'` and `img-src 'self' data:` block remote fonts and remote images. `worker-src 'self' blob:` is limited to the local analysis worker. `wasm-unsafe-eval` is required by the inference runtime; it does not permit remote code or remote evaluation. `form-action 'none'` removes form submission as an exfiltration path.

The static host also sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

## What is stored, and where

| Data | Store | Leaves the device |
| --- | --- | --- |
| Essays, revisions, reports | IndexedDB in the browser profile | No |
| Practice attempts, skill state, assessments | IndexedDB | No |
| Preferences, personal dictionary | IndexedDB | No |
| Imported source materials and generated quizzes | IndexedDB | No |
| Models and dictionary | Same-origin HTTP cache | No |

Browser-managed storage can be cleared or evicted by the browser and is not encrypted secure storage. The app says so in its own settings. No copy of a document exists outside the browser profile unless the user exports one.

## Export

- Export a schema-validated JSON backup of documents, reports, attempts, skills, assessments, materials, and preferences.
- Restore merges the backup and preserves newer local document revisions.
- Backup files are user-initiated downloads. The app does not upload them and has nowhere to send them.

## Erase

- Delete individual documents and source materials inside the app; the IndexedDB records are removed.
- Clear site data in the browser to remove the entire database, including history and practice records.
- Because there is no server copy and no account, erasure is local and immediate. Nothing needs to be requested from an operator.

## How CI proves it

```sh
make verify-offline
```

The check builds the production app, loads it through a real browser, and records every request made during load and during a full analysis and practice flow. It then reloads with the network disabled and requires the app to keep working. Any external host in the request log fails the check. The result is written to [`reports/offline-verification.json`](https://github.com/richie-rich90454/linguorithm/blob/main/reports/offline-verification.json), and the control-corpus results are in [`reports/language-controls.json`](https://github.com/richie-rich90454/linguorithm/blob/main/reports/language-controls.json).

The command delegates to `scripts/task.mjs`; without GNU Make, run `node scripts/task.mjs verify-offline`.
