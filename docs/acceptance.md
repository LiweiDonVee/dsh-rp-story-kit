# Validation scope

Automated checks cover parser/store/source integrity, strict seed, document content, launch/reading, owner transfer and SavedStory coordination; UI tests use real React components and typed owner boundaries. Native adapter tests cover public persistence arguments, fresh original-log initialization, close/cold/resume ordering, owner reads, exact prefixes, inherited counts, cancellation and the narrowly allowed header/end-seed behavior.

Deterministic service/host fixtures exist only under tests. They do not establish native tool acceptance, model quality or actual rc.3 cross-home recovery. Their event envelopes use public Session types; no test fixture is shipped as a production runtime/provider.

## 0.2.0 effective-reading checkpoint

Focused consumer tests exercise public StoryHistory selection when canonical narratives retain accepted old versions, current facts without prose, explicit effective-history failure, actual method availability and legacy fallback. SavedStory provider fixtures check opaque envelope forwarding and owner preflight/restore refusals. These are consumer-contract checks. The actual new Database/GM/LastStep/Context package combination still requires its own accepted-package, different-home and cold-process checkpoint; the historical 0.1.0 result below does not establish that new-version acceptance.

## Actual native result — 2026-10-25, rev5

StoryKit's main transfer driver passed all 13 existing phases in a new isolated official **DSH 0.2.1-rc.3** run, `story-kit-native-JqFAOP`, using fixed driver commit `6e2e0c53ebdbf640a9f6469960359fb3257227cb`. The input manifest SHA256 is `53655f38a83bfac0ae520de729ae6d166041e7997a9d153627fb8416bbaecfdb`. This result was freshly executed; the earlier rev4 rollback result was not relabeled.

| Component | Accepted version / archive identity |
| --- | --- |
| StoryKit | 0.1.0 / `0cb507b9208369f186d2a34e106caaf133d9b4ceb709d088837bfd02a97d6174` |
| GM | 0.1.0 / `9d2f8755d5f2b11c61917dabe5239ba24879be9be3a3885705ce0db4ee756880` |
| Database | 0.2.0 / `7e9a172b7e59a2dbe2014718974575dd9b5243f115f9a3d90fd750ca37738c78` |
| LastStep | 0.3.0 / `f7a5b53a8f9996af3227953c2be985d5c070d4f22c50ed5c74117fd949635773` |
| Context | 0.2.0 / `3b6fa7b2cae4864a718b4d48216257b2c1f27b52bacb406230e164fe06ce85cd` |
| Studio | 1.3.0 / `66a278a984ff41e9b39e27b1694b307ab96d8d4950a43a7d490de67bb2c64ec4` |
| Loop | 0.1.0 / `aee2ccb93b23795139ae8a6dbd2a8e7f3300542e589ea8f7530326030f37f566` |

The run used four exclusive homes and seven actual host processes. Every startup, including cold restarts, checked installed manifest/host/client/patch/README/license bytes against the archives: 288 file checks. One explicit null-Context source scenario omitted Context; the main source and all destination processes used the seven-package combination. Browser and cleanup errors were empty; all owned host processes stopped. Native sidebar/full/narrow widths were 647/1439/519 with no horizontal overflow.

The main path actually exercised native reviewed launch, canonical opening and duplicate fact rejection, pinned assets, initial/current styles, later-added document sources, informational summary UI, reading/SavedStory exports, ancestry and exact-ID restore. A public AbortSignal left existing target Sessions gated in pending state. After stopping the process, the same input snapshot and restoreId completed through real owner checks, Loop policy validation and activation. Public four-field audit, exact prefixes/counts and the successful cold continuation jointly provide the attribution evidence; private journal fields were not used as acceptance assertions.

Before each explicit post-restore action, historical main/prepare/summary/assembly/writer streams and SDK tool execution counts were zero. Each of the two original-child continuation actions produced exactly one new canonical fact receipt and accepted presentation with the exact requested action. The rollback child's authoritative public inbox was empty; its inherited prefix ended after the previous closed turn, excluding the old enqueue. The explicit empty-sources/builtin scenario retained passive default libraries and left imported presets as drafts without automatic rebinding.

## Complementary gates and limits

The matching-seven-package Studio run `studio-full-rev5-20261025-a` owns two complementary combination gates: cold continuation of the newly rolled-back branch with exactly one new fact/presentation, and all exact passive World/Document/profile versions plus original bytes. StoryKit's driver checks rollback prefix/facts/profile and empty inbox, but does not itself cold-prompt that new branch; its passive-library wrapper is not a substitute for Studio's stricter public comparisons. The two owners' evidence is attributed separately. Unified writer/retry/adoption/retrieval scenarios likewise belong to their respective integration evidence.

The test model streams are local and deterministic; this is not a paid-model prose-quality benchmark. The T15/T18 window remains: if creation/original append/flush succeeds but durable attribution is missing after a crash, an occupied ID safely conflicts rather than being adopted by matching content. No unconditional crash recovery, private log edit or ID remapping is claimed.

Reproduction uses `node scripts/native/full.mjs --manifest <approved-final-seven.json> --mode final`; see [the driver guide](../scripts/native/README.md). Per-run manifests, public snapshots/audits, traces, screenshots and process/hash indexes are retained with the acceptance record. The old asset checkpoint and v1/rev4 diagnostics retain their own scope. These source documentation updates do not repack or alter the frozen 0cb archive. Publication remains the coordinator's independently reviewed action.
