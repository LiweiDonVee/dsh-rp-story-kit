# Story Kit asset checkpoint

The native plugin provides rpStoryKit/apiVersion 1 and exact owner Connection routes. Authentication belongs to DSH. Browser requests never choose a Remote endpoint, local path or executable source. Host operations carry lifetime AbortSignals; metadata-only SSE invalidates the library and releases observers on abort/unload.

Pure modules normalize Character/Persona content and parse V2/V3 JSON/common PNG. Original bytes/text, SHA256 and parsed provenance remain separate from editable asset versions. Human edits append immutable versions under one global revision; the local queue serializes multiple store handles and atomically replaces its owned JSON file. Opening IDs survive edits and versions. Same display names do not identify assets.

## Owner service

POST /api/rp-story-kit/request accepts exactly {action,...fields}; GET /api/rp-story-kit/events sends connected/changed metadata only. Every owner mutation below requires nonnegative expectedRevision. Saves require the existing explicit base version.

| Method | Input fields | Result |
| --- | --- | --- |
| state | none | revision, characters, personas, capabilities |
| asset | kind, assetId, version? | revision, asset |
| source | sourceId | source with exact original/provenance |
| importAsset | format=json + rawText, or format=png + dataBase64; name? | revision, assetId, version, sourceId, diagnostics, embeddedWorldbooks |
| createCharacter / saveCharacter | character | revision, assetId, version |
| createPersona / savePersona | persona | revision, assetId, version |
| importWorldbook | assetId, version, descriptorId, expectedDatabaseRevision | revision, assetId, version, databaseRef, diagnostics |
| exportPack | characters: AssetRef[], personas: AssetRef[], templates | pack |
| previewPack | pack | diagnostics, counts, requirements |
| importPack | pack | revision, mappings, diagnostics, reviewRequired |
| launch | frozen character/persona/opening/seed DTO | CAPABILITY_UNAVAILABLE at SK-A |
| exportReading | sessionId, format | CAPABILITY_UNAVAILABLE at SK-A |

AssetRef is {assetId,version}; summaries are {assetId,version,name,sourceId?,avatarResourceId?}. capabilities is {databaseImport,packExport,packImport,launch,readingExport}, all booleans based on actual checkpoint support. Create inputs omit id/version/sourceId. Character has name/description/personality/scenario/openings/examples/creator/databaseRefs and optional source/profile/avatar refs. Persona is name/description plus optional avatar/source refs.

Worldbook descriptor {id,sourceId,sourcePath,name,rawText} carries the full exact JSON card, not a serialized book. importWorldbook checks selected version and delegates rpDatabase.import with the separate expectedDatabaseRevision, then creates a new character version under source slot card. If unavailable, no asset write occurs. The browser obtains Database's current revision via its existing authenticated owner state route.

## Pack provider seam

RP Database and LastStep each expose contentRevision and exportContent/importContent. Exact request fields follow the coordinated v1 contract: databaseId/profileId + version on export; database/profile, source?, requestId and expectedRevision on import. Imported profiles stay draft. The importer first queries each provider's contentRevision, then passes the previous import result revision to the next request.

Pack mappings are grouped as assets/databases/profiles/resources/storyTemplates. Versioned map keys use JSON.stringify([oldId,oldVersion]); values are {assetId,version}, {databaseId,version} or {profileId,version}. Resources and templates have no version field, so map their old IDs to new IDs. A pending import journal persists external mappings/request IDs in the same owned file without publishing staged library assets. Failed provider work leaves the library revision unchanged; retrying the same incomplete pack resumes its journal. A completed new import uses fresh IDs. Cross-store work is resumable, not a distributed transaction.

Content packs carry no Session events or live logs. No call in this checkpoint registers a per-card preset, modifies main-loop messages, launches an Agent or manufactures rp_present acceptance. SK-B uses the existing frozen launch and transfer contracts for real GM, reading export and exact-ID saved-story restore; source existence or positive host mechanism evidence is not itself completed integration.
