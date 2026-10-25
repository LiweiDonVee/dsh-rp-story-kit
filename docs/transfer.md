# Story transfer

Use content packs for reusable material and SavedStory for a whole generic GM story. Reading export is Markdown/TXT from the active LastStep narratives projection.

## Content packs and documents

PackDatabase is {id,version,database,source?,documents?}. Each DocumentContent contains immutable original Document bytes/hash/parser/chunking versions and Extraction{text,chunks}. Entry document provenance resolves to the supplied document version and chunk text/hash, even when an owner later edited the effective entry body. Missing document/chunk and mismatched hashes reject before provider writes.

Database importContent creates fresh destination database/document IDs and remaps its own entries/extraction refs. StoryKit forwards documents independently and preserves returned maps under mappings.databases[JSON.stringify([oldDatabaseId,oldVersion])].documentMappings. Multiple old database versions may thus map one old document/version to different valid destination records. SourcePayload/provenance stays original audit data. Vector caches are excluded; Database uses configured indexing/rebuild behavior.

## SavedStory schema and source capture

```js
{
  format: 'dsh-rp-saved-story', schemaVersion: 1, identityMode: 'preserve',
  exportedAt, selectedSessionId,
  sessions: [{header, events, inheritedEventCount}],
  pluginState: {database, context, lastStep, gm, storyKit},
  resources: [], requirements: [],
  loopPolicies: [{sessionId, policy}] // optional
}
```

Capture includes the selected story and its required ancestors, with actual public inheritedEventCount metadata. A missing count is EXPORT_SOURCE_METADATA_MISSING; no cut is inferred from similar events. Only active, idle generic stories with no queued input are exported. StoryKit holds cross-owner maintenance and compares content revisions, canonical records and policy revisions; any change returns EXPORT_CHANGED for explicit retry.

Pinned assets and reviewed launch configuration remain operational library references. StoryKit collects their defined typed refs and asks the owning Database/LastStep exportState methods to include additionalDatabaseRefs/additionalProfileRefs; it does not scan original provenance or entire libraries. GM.binding initial profile references are also retained through LastStep. A launch journal is startup configuration, not a StoryTemplate asset: its presence alone cannot label a reference asset-default. The informational summary labels only actual included pinned defaults and the selected current public Database/LastStep binding; an initial-only reference remains in the closure without an invented summary role. Missing exact source versions are EXPORT_REQUIREMENT_MISSING with safe refs, not latest-version substitution. Source/document dependencies remain owner-managed; a Document.databaseId alone does not invent V1 or latest.

GM.binding.sources is likewise initial launch provenance. Every included public GM binding contributes its exact databaseId/version pairs to additionalDatabaseRefs, even without a Story Kit launch journal; SourceBinding.key does not change library identity. Restored initial libraries are checked through Database.database before activation. Current Database composition may legally include later compatible sources and remains unchanged; retaining an initial-only version does not rebind it or add a summary role.

For example, a card defaulting to WorldV1/StyleV1 may currently run with sources=[] and builtin. The snapshot retains WorldV1/StyleV1 as library-only content; draft StyleV1 stays draft, while current empty sources/builtin remain unchanged. A later legitimate LastStep rebind remains current; GM.profile is launch provenance only. Restore checks retained exact versions without auto-binding them or applying ready validation to passive draft defaults.

Context is null when absent from the source environment. Existing disabled Context still exports its real owner state. Source documents/assets/profiles and all required causal/audit state remain within their owning provider envelopes; no unrelated whole store or derived vector cache is bundled.

## Restore order and interrupted jobs

1. Validate transport, exact identities, content collisions and provider/model requirements before writes. Existing Session IDs are accepted only when reserved/owned by the same matching restore job. Identical immutable library ID/version content can be reused; conflicting content returns RESTORE_CONTENT_CONFLICT.
2. Persist the small coordinator journal, then reserve the approved IDs through GM. This gates execution but grants no Session ownership.
3. Import parent-first through public persistence. A new create is flushed and its success durably recorded in createdIds before append; only those proven IDs may reopen/write a matching owned prefix. A foreign ID appearing before create loses with RESTORE_ID_CONFLICT, without append. Cold public Session validation follows the exact original append/flush/close.
4. Restore each owner's state, LastStep before Context note proof and GM metadata before StoryKit asset associations. Available canonical proof precedes each owner's atomic merge.
5. Safely resume actual Agents without prompting. Each retry verifies current live registry state through the adapter; a historical resumed checkpoint does not skip cold-process reconstruction. If source Context was null and target Context exists, use its normal per-session configure(enabled:false).
6. Validate the actual Loop graph and apply only session overrides. Then GM.activateRestored performs remaining real-Agent fact checks and clears its reservation. Only confirmed activation returns complete.

Preview is read-only. LOOP_NODE_VALIDATION in deferredChecks means actual graph eligibility remains conditional until the gated resume phase. A missing model/node never selects a fallback or discards a policy; the job stays pending with its original file and restoreId.

Record the restore task ID shown in the native panel. Restart or network interruption uses the same file and ID. REQUEST_ID_CONFLICT concerns content-provider payload reuse; RESTORE_ID_CONFLICT covers changed restore payload/Session set or an unrelated occupied destination ID. Transport errors are checked before identity; existing identity is checked before deeper schema/log/material proof. Expected revision alone does not change payload identity.

The journal records reservations, owned IDs, completed imports/cold checks/provider phases, resume intent/results, per-session policy and activation intent. It stores no second copy of facts or full Session bundle. Progress resumes rather than overwriting preexisting data. Independent stores are not a cross-store atomic transaction.

There is one public-API attribution limit: create/flush may succeed before StoryKit's createdIds checkpoint is durably stored. After a crash in that interval, public headers/revisions/prefix contents do not identify the creating restore job. Automatic recovery refuses that occupied ID with RESTORE_ID_CONFLICT and preserves pending/conflict state and all existing bytes. It does not append, delete, modify the header or adopt it by content equality. Explicit owner resolution or an empty destination is required. Normal exact restore and durably recorded creation progress remain supported; crash-resumability is not unconditional.

Optional dependencySummary lists ID/version and uses current-binding / asset-default. Current means only the selected story's public effective Database sources and actual LastStep binding, not ancestor history or GM initial style. Defaults come from included pinned assets/templates. The UI labels it recorded informational use; an asset-default-only row is not current, but may have been used historically. Legacy absence is shown as not recorded. Summary content cannot add/drop dependencies, authorize restore, change bindings or substitute for owner validation.

For verified rc.3 structural comparisons only, absent/undefined delegationDepth equals numeric 0. Other header changes and all original events remain strict. The one allowed resume suffix is the real session/end-seed marker; unknown extra events reject. A lost activation acknowledgement is finalized only after the persisted activation intent and actual owner bindings confirm the non-restoring state.

## Environment requirements

Configure model/provider credentials independently on the destination. Preview reports missing providers/models/presets and unsupported stage requirements. The reusable package contains implementations against actual host services, while fixture tests establish coordination behavior only. Actual separate-home/native/cold-restart/fork acceptance is tracked separately in the implementation report.
