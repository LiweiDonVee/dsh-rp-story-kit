# Native asset/content checkpoint

Use a coordinator-reviewed local JSON input with `hostVersion: "0.2.1-rc.3"` and `packages: [{name, version, path, sha256}]`. Each path must identify an accepted immutable archive. The asset runner requires Story Kit, Database, LastStep, Context, Loop and Studio, and rejects GM inputs because full launch/SavedStory acceptance is a separate dispatch.

```powershell
node --test scripts/native/host.test.mjs
node scripts/native/run.mjs --manifest .runtime/native-assets-inputs.json
```

The runner exclusively creates new homes under a new physical checkout `.runtime/story-kit-native-*` directory. It does not accept an existing home or a destination run path. It stages SHA-named archives, uses the official installed CLI, verifies each actual manifest/host/client/patch against the archive, then starts the official web host on an ephemeral loopback port. The test-only probe registers local model metadata and fixed owner observations; a model generation request is an explicit failure. No production owner is replaced.

The actual product scenarios cover native ccv3 PNG import (with competing chara metadata), BOM/CRLF source preservation, inert scripts, delegated full-card worldbook import, immutable previous asset versions, persona editing, document import, real provider content export, native pack preview/import into a second fresh home, new identity/document mappings, source audit, retained draft profiles, actual cold process restart and sidebar/full/narrow screenshots. The profile selector is exercised while absent GM keeps launch unavailable. Runtime profile precedence, dependency summary, reading, launch, ancestry/SavedStory, Loop restore and fork still require final accepted GM and their separate real scenario.

Evidence stays in the run directory: `integration.json`, per-home install logs, SHA inputs/index, redacted host logs, public synthetic pack/mappings and screenshots. `status: passed-assets-content-only` cannot be promoted to full restore acceptance. Failed/incomplete runs are retained, and cleanup stops only child process trees created by this runner.

## Final Story Kit transfer driver

```powershell
node --test scripts/native/*.test.mjs
node scripts/native/full.mjs --manifest <coordinator-final-seven.json> --mode final
```

The final driver requires the exact seven coordinator-approved archives and `stage: final`; production service success always comes from those installed owners. Every process, including cold restarts, rechecks installed manifest/host/client/patch hashes and records actual APIs. Only LLM streams are local deterministic fixtures. The probe's public observations and tools/execute listener do not replace owner results. It never writes a private journal or Session file.

The main source keeps Context installed, launches via native reviewed seed/profile UI, exercises real duplicate factual-commit error projection, legally adds a document source, selects current B while initial A and asset default C remain distinct, then forks a B prefix after the parent later selects D. It exports through the native SavedStory/reading buttons. The destination preview reports deferred Loop checks; a public AbortSignal interrupts the real coordinator once an actual Agent exists while GM is still restoring. A whole-process cold restart continues the exact same snapshot/restoreId through the native UI, real Loop and activation. Public state/headers/events, exact passive defaults, source bytes, inherited markers/counts, zero historical model/tool execution, imported-prefix rollback and ordinary continuation are checked. A further cold process starts with zero historical execution and handles a new explicit action.

A separate source deliberately omits Context to exercise the frozen null-Context protocol and explicit empty sources/builtin override. It removes only informational summary before the first restore job; exact old defaults remain library content and the target's normal Context configuration disables that session. A fresh collision home uses public persistence to occupy an original ID with the same real source records, then verifies refusal, unchanged public records/owner revisions and inability of an edited summary to authorize restore.

Diagnostic mode is explicit and is never final acceptance. `--mode diagnostic` uses the normal main path; `--mode diagnostic --case null` isolates the null/pending/cold path; `--mode diagnostic --case main-no-context` isolates coordinator/ancestry mechanics while an external Context export issue is being repaired. Final mode rejects these omitted-Context main-case shortcuts. Do not substitute their passed statuses for the final Context and appended-source scenario. The T15 create/append/flush-to-checkpoint attribution window remains fail-closed, as documented in the public transfer guide.

Final evidence is `full-integration.json`, source/public snapshots, actual model/tool traces per process, pending and restored public states, rollback records, collision before/after proof, per-process package hashes/API observations, redacted logs and native screenshots. Failed runs retain an incomplete status. Each attempted scenario is bounded; there is no retry loop that converts an unexplained failure into success.
