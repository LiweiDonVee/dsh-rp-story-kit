# Story Kit Assets Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans and test-driven-development. No subagents are authorized for SK-A.

**Goal:** Deliver the approved SK-A standalone asset library checkpoint, leaving actual GM launch to SK-B.

**Architecture:** Pure asset, import, PNG and pack modules; revisioned local store; exact owner routes and a native React sidebar. Source bytes remain immutable. External Database/Profile operations use frozen provider seams rather than copied implementations.

**Tech Stack:** Node 24, React 18 from DSH, esbuild, node:test, Vitest/jsdom, Testing Library, pnpm 11.9.

**Spec:** Coordinator-frozen `story-kit-assets.md` and `contracts.md`, 2026-10-25. Public service/pack subsidiary DTO clarification is requested before those boundaries are implemented.

## Global constraints

- DSH 0.2.1-rc.3 is the current target; label static and actual-host evidence separately.
- No per-card runtime/preset, NPC ACL, synthetic Session/rp_present events, or ST script execution.
- Only public synthetic fixtures; settings-only cards are valid assets; examples remain examples.
- Character and Persona DTOs and SourceBinding ownership follow the frozen brief exactly.
- Work only in the coordinator-created empty repository and feature branch. Do not push.

## Task 1: JSON/PNG asset import

Files: `src/assets.mjs`, `src/import.mjs`, `src/png.mjs`, `tests/import.test.mjs`, `tests/fixtures/`.

- [ ] Write the literal V2/V3 and PNG tests first. Example assertion: `assert.equal(result.character.openings[1].id, 'alternate-1')`; unchanged source bytes and literal macro/script provenance must survive.
- [ ] Run `node --test tests/import.test.mjs`; verify expected absent-feature failures before adding implementations.
- [ ] Implement schema normalization, lossless source storage, chara/ccv3 extraction, ccv3 preference, CRC/chunk validation, APNG/ZIP diagnostics and embedded-book descriptor.
- [ ] Re-run the focused suite and record GREEN.

## Task 2: Immutable library storage

Files: `src/store.mjs`, `tests/store.test.mjs`.

- [ ] RED cases create/edit same-name personas, pinned character versions, exact source/resource restart and stale writes. Example: save version 1 twice; the second stale save must return a conflict without changing revision.
- [ ] Run the focused suite before implementation.
- [ ] Implement queue/atomic replacement, unique IDs, sources/resources, immutable asset versions and revision protection.
- [ ] Run focused GREEN; preserve selection state outside canonical story state.

## Task 3: Content-pack kernel

Files: `src/packs.mjs`, `tests/packs.test.mjs`.

- [ ] Read the coordinator's exact frozen subsidiary pack/provider DTOs before defining this boundary.
- [ ] RED cases exercise round-trip, ID/reference remapping, resource hash checks, unsupported requirements, invalid pack data and isolated DB/profile provider results.
- [ ] Implement data-only validate/export/import and explicit maps, without canonical session restoration.
- [ ] Run focused GREEN with real asset storage and controlled external provider boundaries.

## Task 4: Owner host/routes and native editor

Files: `src/host.mjs`, `src/routes.mjs`, `src/api.js`, `src/client.jsx`, `src/StoryKitWorkspace.jsx`, `src/styles.css`, `tests/{host,routes}.test.mjs`, `tests/ui/story-kit-workspace.test.jsx`.

- [ ] Read the frozen service/action DTO clarification before adding public actions.
- [ ] RED owner validation, deferred embedded-book capability, native slot lifecycle, import review, version conflicts, persona/opening selection and unavailable launch.
- [ ] Implement the exact DTOs; import books by delegation to rpDatabase only. Keep UI subscriptions/requests scoped to session visibility.
- [ ] Run host and UI GREEN; no launch success claim before SK-B.

## Task 5: Bundled skill and distribution

Files: `skills/adapting-roleplay-story-assets/`, `scripts/{build,pack,check-skill}.mjs`, `README.md`, `docs/skill-evaluation.md`, `LICENSE`, CI.

- [ ] Write the settings-only/two-opening/examples-not-facts scenario before the skill. Record the reference-only evaluation's limits; no unauthorized agent delegation.
- [ ] Author focused field mapping, original creation and provenance guidance plus a complete worked behavior example.
- [ ] Validate frontmatter, resource references and packaged skill contents. Build Node ESM + host-React browser bundle and standalone tgz.

## Task 6: Final verification and initial commit

- [ ] Run `pnpm check`, `pnpm skill:check`, `pnpm package`, inspect archive manifest and rerun affected tests after any fix.
- [ ] Verify the full frozen SK-A checklist, `git diff --check`, package contents and clean staged scope.
- [ ] Commit with command-scoped `user.name=Codex`, `user.email=codex@local`; do not push.
- [ ] Record commit, public DTOs, test counts and exact SK-B seams in the coordinator report.
