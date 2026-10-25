# Story Kit Launch and Transfer Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans and test-driven-development. No subagents are authorized.

**Goal:** Implement the frozen SK-B coordinator and native owner workflows, with honest production capability gates and separate actual-host acceptance evidence.

**Architecture:** Small launch/reading, native host-adapter, own transfer-state and saved-story coordinator modules compose the accepted SK-A asset store. Real service seams are looked up from DSH; deterministic fixtures exist only in tests. Exact logs are written solely through public sessionPersistence and cold-validated before owner state restoration/resume/activation.

**Tech Stack:** Node24, existing host React18/native sidebar, node:test, Vitest/jsdom, esbuild.

**Spec:** Latest coordinator-frozen story-kit-launch-transfer brief, common contracts, runtime R1–R15, transfer T1–T5, StoryKit SK1–SK4 and Studio contracts. BASE 3de0c71231480c450f3f031e2dc389324e3acd94.

## Constraints and pending interface review

- Preserve original bytes/provenance and IDs in SavedStory; only content-pack providers remap document/source/entry/chunk identities.
- No sibling source imports, private Session file copying, generated historical tools, credentials, or media.
- Launch resolves immutable selected content plus explicitly reviewed R8 seed. No implicit profile readying or inference of facts from examples.
- Production availability reflects actual compatible services. Fixtures establish coordinator behavior only.
- Root/Astra closed the interface questions in T7–T11 and SK5/SK6: authoritative counts, nullable Context, scoped maps, pendingLaunches/resumeLaunch, exact profile precedence, saved capability booleans and deferred actual Loop-node checks. GM export does not reacquire coordinator maintenance.

## Task 1: Explicit document content in packs

Files: src/documents.mjs, src/packs.mjs, tests/documents.test.mjs.

- [ ] RED: Missing referenced document/chunk, wrong raw/chunk hash, mismatched database/ref/version and independent source audit preservation.
- [ ] Run node --test tests/documents.test.mjs before implementation.
- [ ] Validate T4 DocumentContent and forward documents separately through real provider seam; retain returned contextual documentMappings in the approved shape.
- [ ] Focused GREEN; ordinary no-document packs remain compatible.

## Task 2: Launch/reading and own transfer provider

Files: src/launch.mjs, src/transfer-state.mjs, store/host integration and matching Node tests.

- [ ] RED immutable character/persona/opening handoff, strict seed reuse, launchId replay/conflict, restart after partial preparation, missing services and draft-profile rejection.
- [ ] RED reading contains active accepted narratives only; stale candidate/process/raw-source text excluded.
- [ ] RED own export scopes immutable versions/resources to supplied session bindings; exact-ID preflight collisions and restoreId same/different payload behavior.
- [ ] Implement only frozen service DTOs; persist reviewed launch request and small progress journals. Own atomic restore never overwrites unrelated content.
- [ ] Focused GREEN with typed service fixtures and no production stand-ins.

## Task 3: Public native session adapter and saved-story coordinator

Files: src/native-session.mjs, src/saved-story.mjs, tests/saved-story.test.mjs.

- [ ] RED stable idle/maintenance export with full ancestry and before/after content revisions; EXPORT_CHANGED for any relevant mutation.
- [ ] RED all preflight identity/content/provider failures leave destination untouched; same restoreId retries resume only their reserved identities.
- [ ] RED order: preflight → GM reserve → exact public persistence/cold validation → Database/LastStep/Context/GM/StoryKit state → resume without prompt → optional session Loop policy → GM activation.
- [ ] Implement durable phase checkpoints and safe pending/failed diagnostics. Never report complete before every phase and exact-prefix check succeeds.
- [ ] Focused GREEN; test interrupted write/import/resume/activation retries and conflicting payload/session-set IDs.

## Task 4: Native owner UI/routes and capability projection

Files: src/StoryKitWorkspace.jsx, src/api.js, src/routes.mjs, src/host.mjs, UI/route tests.

- [ ] RED owner-reviewed seed form, immutable saved selection, default/profile/model inheritance, partial launch recovery and host navigation.
- [ ] RED real content/reading export and SavedStory preview/restore UI with explicit unavailable dependencies/model/node requirements.
- [ ] Implement exact allowed owner DTOs and approved additive capability/read fields; preserve existing F1 lifecycle ownership and F2 source integrity.
- [ ] UI and route GREEN; no placeholder native success and no generic service proxy.

## Task 5: Verification and checkpoint handoff

- [ ] Run pnpm check, skill:check, package, inspect archive/SHA256 and git diff --check.
- [ ] Actual accepted dependency packages/native homes are a separate required acceptance phase; report fixtures and real evidence distinctly.
- [ ] Commit owned repo with command-scoped Codex <codex@local>, no push.
- [ ] Write reports/story-kit-launch-transfer-report.md with BASE/SHA/API/tests/hash, outstanding actual-host gate and exact integration seams; stop for independent review.
