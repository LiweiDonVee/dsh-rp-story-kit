# Native asset/content checkpoint

Use a coordinator-reviewed local JSON input with `hostVersion: "0.2.1-rc.3"` and `packages: [{name, version, path, sha256}]`. Each path must identify an accepted immutable archive. The asset runner requires Story Kit, Database, LastStep, Context, Loop and Studio, and rejects GM inputs because full launch/SavedStory acceptance is a separate dispatch.

```powershell
node --test scripts/native/host.test.mjs
node scripts/native/run.mjs --manifest .runtime/native-assets-inputs.json
```

The runner exclusively creates new homes under a new physical checkout `.runtime/story-kit-native-*` directory. It does not accept an existing home or a destination run path. It stages SHA-named archives, uses the official installed CLI, verifies each actual manifest/host/client/patch against the archive, then starts the official web host on an ephemeral loopback port. The test-only probe registers local model metadata and fixed owner observations; a model generation request is an explicit failure. No production owner is replaced.

The actual product scenarios cover native ccv3 PNG import (with competing chara metadata), BOM/CRLF source preservation, inert scripts, delegated full-card worldbook import, immutable previous asset versions, persona editing, document import, real provider content export, native pack preview/import into a second fresh home, new identity/document mappings, source audit, retained draft profiles, actual cold process restart and sidebar/full/narrow screenshots. The profile selector is exercised while absent GM keeps launch unavailable. Runtime profile precedence, dependency summary, reading, launch, ancestry/SavedStory, Loop restore and fork still require final accepted GM and their separate real scenario.

Evidence stays in the run directory: `integration.json`, per-home install logs, SHA inputs/index, redacted host logs, public synthetic pack/mappings and screenshots. `status: passed-assets-content-only` cannot be promoted to full restore acceptance. Failed/incomplete runs are retained, and cleanup stops only child process trees created by this runner.
