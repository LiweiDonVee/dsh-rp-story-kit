# Asset mapping and owner interface

Character fields: id/version/name/description/personality/scenario/openings/examples/creator/sourceId?/databaseRefs/profileRef?/avatarResourceId?. Persona fields: id/version/name/description/avatarResourceId?/sourceId?. SourceBinding is {key,databaseId,version}; key is a binding slot, never a source UUID, and @session is reserved.

| Card source | Character content |
| --- | --- |
| data.name / description / personality / scenario | Same named text fields |
| data.first_mes | openings entry id first |
| data.alternate_greetings | Entries alternate-1, alternate-2, in source order |
| data.mes_example | examples, never canonical story history |
| creator / creator_notes / character_version / tags | creator.name / notes / version / tags |
| system_prompt, post_history_instructions | Original provenance only, explicit owner-review diagnostic |
| character_book | Deferred full-card descriptor for Database |
| extensions, script/regex/macro fields | Exact source and inert diagnostics |

V3 group-only greetings and additional unsupported behavior remain in provenance. PNG prefers ccv3 when present, otherwise chara. Invalid preferred metadata reports an error instead of silently choosing different content. ZIP and APNG are explicitly unsupported at this checkpoint.

The owner service is rpStoryKit with apiVersion 1. POST /api/rp-story-kit/request takes exactly {action,...methodFields}. Relevant methods:

```js
state({signal})
asset({kind: 'character', assetId, version, signal})
source({sourceId, signal})
importAsset({format: 'json', rawText, expectedRevision, signal})
importAsset({format: 'png', dataBase64, expectedRevision, signal})
createCharacter({character, expectedRevision, signal})
createPersona({persona, expectedRevision, signal})
saveCharacter({character, expectedRevision, signal})
savePersona({persona, expectedRevision, signal})
launch({launchId, character, persona, openingId, sources, profile, initialScene, initialFacts, signal})
resumeLaunch({launchId, signal})
```

Create inputs omit id/version/sourceId. Store responses identify assetId/version/revision. Saves include the current explicit version. Never select identity by display name. Obtain current revisions from the actual service; do not invent or automatically rebase a stale owner's edits.

EmbeddedWorldbook is {id,sourceId,sourcePath,name,rawText}. rawText is the entire original JSON card, including exact decoded card metadata for PNG. importWorldbook takes {assetId,version,descriptorId,expectedRevision,expectedDatabaseRevision,signal}; it delegates Database's parser and saves a new asset version linked under source slot card. It does not mutate the original or import a book during raw parsing.

Content packs use format dsh-rp-story-pack/schemaVersion 1, with assets/databases/profiles/storyTemplates/resources/requirements. They contain no credentials, local provider settings, executable modules or running session logs. Foreign IDs are pack-scoped and remapped; imported profiles stay review drafts. Do not confuse these packs with the separate dsh-rp-saved-story restore format.

Launch/template initialScene is exactly {schemaVersion:1,title,location,time?,presentActorIds:string[]}; initialFacts is exactly {schemaVersion:1,items:[{id,text}]}. Examples never populate these objects. Explicit profile object wins; explicit null selects builtin; omission inherits Character.profileRef when present. Draft/missing links are explicit errors. A pending launch resumes its persisted reviewed request, rather than current editor values.

DocumentContent travels in PackDatabase.documents, with contextual documentMappings from Database. SourcePayload/provenance stays original audit data. Reading export uses current adopted narratives. SavedStory carries exact Session IDs/headers/events/inheritedEventCount and owner state, with one durable restoreId; it is never an instruction to copy Session files or remap event IDs. Missing provider/model capabilities and deferred Loop graph checks remain explicit in owner preview.
