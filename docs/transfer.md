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

Context is null when absent from the source environment. Existing disabled Context still exports its real owner state. Source documents/assets/profiles and all required causal/audit state remain within their owning provider envelopes; no unrelated whole store or derived vector cache is bundled.

## Restore order and interrupted jobs

1. Validate transport, exact identities, content collisions and provider/model requirements before writes. Existing Session IDs are accepted only when reserved/owned by the same matching restore job. Identical immutable library ID/version content can be reused; conflicting content returns RESTORE_CONTENT_CONFLICT.
2. Persist the small coordinator journal, then reserve the approved IDs through GM. Play remains gated while partial.
3. Import parent-first exact headers/events/counts through sessionPersistence.create/open handles, append the remaining original prefix, flush and close. Cold public Session validation must confirm it.
4. Restore each owner's state, LastStep before Context note proof and GM metadata before StoryKit asset associations. Available canonical proof precedes each owner's atomic merge.
5. Safely resume actual Agents without prompting. If source Context was null and target Context exists, use its normal per-session configure(enabled:false).
6. Validate the actual Loop graph and apply only session overrides. Then GM.activateRestored performs remaining real-Agent fact checks and clears its reservation. Only confirmed activation returns complete.

Preview is read-only. LOOP_NODE_VALIDATION in deferredChecks means actual graph eligibility remains conditional until the gated resume phase. A missing model/node never selects a fallback or discards a policy; the job stays pending with its original file and restoreId.

Record the restore task ID shown in the native panel. Restart or network interruption uses the same file and ID. REQUEST_ID_CONFLICT concerns content-provider payload reuse; RESTORE_ID_CONFLICT covers changed restore payload/Session set or an unrelated occupied destination ID. Transport errors are checked before identity; existing identity is checked before deeper schema/log/material proof. Expected revision alone does not change payload identity.

The journal records reservations, owned IDs, completed imports/cold checks/provider phases, resume intent/results, per-session policy and activation intent. It stores no second copy of facts or full Session bundle. Progress resumes rather than overwriting preexisting data. Independent stores are not a cross-store atomic transaction.

For verified rc.3 structural comparisons only, absent/undefined delegationDepth equals numeric 0. Other header changes and all original events remain strict. The one allowed resume suffix is the real session/end-seed marker; unknown extra events reject. A lost activation acknowledgement is finalized only after the persisted activation intent and actual owner bindings confirm the non-restoring state.

## Environment requirements

Configure model/provider credentials independently on the destination. Preview reports missing providers/models/presets and unsupported stage requirements. The reusable package contains implementations against actual host services, while fixture tests establish coordination behavior only. Actual separate-home/native/cold-restart/fork acceptance is tracked separately in the implementation report.
