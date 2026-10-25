# Story Kit architecture

The native plugin provides rpStoryKit/apiVersion 1 and exact owner Connection routes. Authentication belongs to DSH. Browser requests never choose a Remote endpoint, local path or executable source. Host operations carry lifetime AbortSignals; metadata-only SSE invalidates the library and releases observers on abort/unload.

Pure modules normalize Character/Persona content and parse V2/V3 JSON/common PNG. Original bytes/text, SHA256 and parsed provenance remain separate from editable asset versions. Pack sources are re-derived from authoritative bytes and any supplied text/provenance must agree; PNG sources use the actual preferred metadata/chunk validation path. Human edits append immutable versions under one global revision; the local queue serializes multiple store handles and atomically replaces its owned JSON file. Opening IDs survive edits and versions. Same display names do not identify assets.

## Owner service

POST /api/rp-story-kit/request accepts exactly {action,...fields}; GET /api/rp-story-kit/events sends connected/changed metadata only. Library edits/imports require nonnegative expectedRevision; saves require the explicit existing base version. Launch and restore use their frozen launchId/restoreId identity rules.

| Method | Input fields | Result |
| --- | --- | --- |
| state | none | revision, characters, personas, pendingLaunches, capabilities |
| asset | kind, assetId, version? | revision, asset |
| source | sourceId | source with exact original/provenance |
| importAsset | format=json + rawText, or format=png + dataBase64; name? | revision, assetId, version, sourceId, diagnostics, embeddedWorldbooks |
| createCharacter / saveCharacter | character | revision, assetId, version |
| createPersona / savePersona | persona | revision, assetId, version |
| importWorldbook | assetId, version, descriptorId, expectedDatabaseRevision | revision, assetId, version, databaseRef, diagnostics |
| exportPack | characters: AssetRef[], personas: AssetRef[], templates | pack |
| previewPack | pack | diagnostics, counts, requirements |
| importPack | pack | revision, mappings, diagnostics, reviewRequired |
| launch | launchId, character/persona AssetRef, openingId, sources, profile?, initialScene, initialFacts | sessionId, binding, status |
| resumeLaunch | launchId | sessionId, binding, status |
| exportReading | sessionId, format=markdown/text | fileName, mimeType, text |
| exportSavedStory | sessionId | snapshot |
| previewSavedStory | snapshot | supported, conflicts, requirements, identityMode, deferredChecks |
| restoreSavedStory | snapshot, restoreId | status, sessionId, diagnostics |

AssetRef is {assetId,version}; summaries are {assetId,version,name,sourceId?,avatarResourceId?}. capabilities is {databaseImport,packExport,packImport,launch,readingExport,savedStoryExport,savedStoryPreview,savedStoryRestore}, all booleans based on actual compatible services and implemented mechanisms. Pending launch summaries contain launchId/title/status/createdAt and optional sessionId/errorCode. Create inputs omit id/version/sourceId. Character has name/description/personality/scenario/openings/examples/creator/databaseRefs and optional source/profile/avatar refs. Persona is name/description plus optional avatar/source refs.

Worldbook descriptor {id,sourceId,sourcePath,name,rawText} carries the full exact JSON card, not a serialized book. importWorldbook checks selected version and delegates rpDatabase.import with the separate expectedDatabaseRevision, then creates a new character version under source slot card. If unavailable, no asset write occurs. The browser obtains Database's current revision via its existing authenticated owner state route.

## Pack provider seam

RP Database and LastStep each expose contentRevision and exportContent/importContent. Exact request fields follow the coordinated v1 contract: databaseId/profileId + version on export; database/profile, source?, requestId and expectedRevision on import. Imported profiles stay draft. The importer first queries each provider's contentRevision, then passes the previous import result revision to the next request.

Pack mappings are grouped as assets/databases/profiles/resources/storyTemplates. Versioned map keys use JSON.stringify([oldId,oldVersion]); Database mappings additionally retain sourceId? and documentMappings? under that database/version key. DocumentContent is a separate documents field; original source provenance is audit data. SourceBinding selects only key/databaseId/version from the mapping. Resources and templates have no version field, so map their old IDs to new IDs. A pending import journal persists external mappings/request IDs in the same owned file without publishing staged library assets. Failed provider work leaves the library revision unchanged; retrying the same incomplete pack resumes its journal. A completed new import uses fresh IDs. Cross-store work is resumable, not a distributed transaction.

Content packs carry no Session events or live logs. Launch uses the one shared rpGM.startStory service with pinned character/persona fields, selected opening, explicit source bindings and reviewed seed. Profile precedence preserves explicit null versus omission. The immutable normalized request/fingerprint is committed before dispatch; resumeLaunch reuses it rather than current editor state. The GM owns normal native opening execution and canonical acceptance.

Template and launch seeds use the shared `src/seeds.mjs` validateStorySeed kernel. initialScene is exactly {schemaVersion:1,title:string,location:string,time?:string,presentActorIds:string[]}; initialFacts is exactly {schemaVersion:1,items:[{id:string,text:string}]}. Missing/wrong/extra fields and duplicate fact IDs reject with INVALID_SEED before provider writes or local journal creation. Bare facts arrays are rejected, never silently converted.

## Exact-ID transfer

StoryKit's plugin-only contentRevision/exportState/preflightRestore/restoreState methods carry scoped session asset associations, immutable Character/Persona versions, original sources/resources, reviewed launch records and small journal audit summaries. Preflight does not require target logs. Restore validates actual authorized canonical sessions and GM bindings before one serialized merge; unrelated destination versions remain intact. Existing restore identity is checked before deep proof, excluding expectedRevision from identity.

The saved-story coordinator alone holds cross-owner public Agent.runMaintenance locks for stable export. Providers take their own local snapshots. It compares content revisions, relevant logs and Loop revisions before returning a bundle. Restores preflight identities/content/dependencies, reserve GM execution, import exact logs via public persistence handles and cold validation, then restore Database → LastStep → Context → GM → StoryKit. LastStep precedes consumed-note validation. Agent-scoped GM fact proof occurs in activateRestored after safe resume.

Loop preview validates known stage shapes and available model metadata without creating/resuming a Session. Actual node/control eligibility is deferred and shown to the user; restore checks the resumed graph and writes only session policy. Absent source Context is null; normal destination configure(enabled:false) preserves that behavior per restored session. The coordinator never writes another owner's store.

The native adapter preserves authoritative inheritedEventCount. It normalizes only absent/undefined header.delegationDepth versus numeric zero for structural comparison. Events and sources remain exact. After no-prompt resume, it rechecks the original prefix and accepts only one verified session/end-seed suffix. Resume/activation intent and acknowledged phases are journaled so interrupted acknowledgements do not duplicate work. See [transfer details](transfer.md) and [evidence boundaries](acceptance.md).
