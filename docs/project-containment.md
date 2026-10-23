# Project containment and authorized cleanup

All additions for this project now reside under C:\Users\rjian\Desktop\grammar-practice.

| Content                                       | Location               |
| --------------------------------------------- | ---------------------- |
| Node                                          | .tools/node            |
| pnpm                                          | .tools/pnpm12          |
| Python base                                   | .tools/python          |
| Python packages                               | .venv                  |
| JavaScript packages                           | node_modules           |
| Browser binaries                              | .cache/ms-playwright   |
| Package/model/tool caches and temporary files | .cache                 |
| Raw corpora and notices                       | training/datasets/raw  |
| Trained candidates                            | models/generated       |
| Packaged browser model resources              | apps/web/public/models |

Use GNU Make for development commands. `scripts/task.mjs` selects local runtimes and places caches, package-manager configuration, and temporary files inside the checkout on Windows, macOS, and Linux. Dot-source scripts/project-env.ps1 only for manual PowerShell training commands. These adjust only the child process environment; they do not alter global PATH or user configuration. CI uses the same Make targets and installs its package manager in its checkout instead of a global npm prefix.

For this project, no npm or Python packages were globally installed. Two browser directories were previously downloaded outside the project. After verified local copies were tested, the user explicitly approved deletion of exactly:

- C:\Users\rjian\AppData\Local\ms-playwright\firefox-1555
- C:\Users\rjian\AppData\Local\ms-playwright\webkit-2370

Those two external directories have been deleted. Other versions, older tools, shared caches, and unrelated applications were not deleted.

The application stores user documents in browser-managed IndexedDB as required by the local-first specification. Browser profile/storage directories are managed by the user's browser; the project-local requirement applies to installed development runtimes, dependencies, models, and generated artifacts. Automated tests use project-local temporary/browser paths.
