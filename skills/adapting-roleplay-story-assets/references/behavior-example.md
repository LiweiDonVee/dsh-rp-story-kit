# Worked example: a setting is an asset

Owner request: “Import this public synthetic fog-harbor setting card. Keep both openings. My lightweight persona is a traveling mapmaker. Do not start yet.”

The card has description “A harbor whose traffic follows the tide”, personality “Residents value promises”, a first opening at the lighthouse, and an alternate opening at the exposed old steps. Its example dialogue says “The lighthouse is across the east pier.” Source metadata includes a system prompt, a literal macro, inert regex metadata and a Character Book.

An appropriate result uses importAsset on the exact JSON text, then reads the returned immutable character version. The normalized content is shaped as:

```json
{
  "name": "Fog Harbor",
  "description": "A harbor whose traffic follows the tide",
  "personality": "Residents value promises",
  "scenario": "The mapmaker reaches a closed port",
  "openings": [
    {"id":"first","name":"Default opening","text":"The lighthouse bell crosses the fog."},
    {"id":"alternate-1","name":"Old steps","text":"Low tide exposes the old steps."}
  ],
  "examples": "{{user}}: Where is the lighthouse?\n{{char}}: Across the east pier.",
  "creator": {"name":"Public synthetic example"},
  "databaseRefs": []
}
```

This is content to review, not the import request itself: importAsset must receive the untouched source. The store supplies a fresh asset ID, version 1 and sourceId; the source keeps the original bytes, SHA256 and parsed provenance. Save any owner-requested renaming of the second opening as a new version while retaining alternate-1.

Create the persona separately:

```json
{"action":"createPersona","persona":{"name":"Traveling mapmaker","description":"A visitor drawing a new harbor chart."},"expectedRevision":1}
```

Here revision 1 is illustrative only: read the actual current revision before writing. Another persona with the same display name receives a different ID.

Review result: both openings are available; no opening is committed yet. The east-pier exchange stays in examples and contributes zero historical events or initial facts. The system prompt, macro and regex remain inert source metadata. The Character Book descriptor retains the full card text; with no Database service, report “worldbook preserved, import deferred.”

No playable NPC is required, so do not reject the setting. Do not create a per-card runtime or preset. No startStory, Session append, rp_present result, profile-ready flag or GM fact commit occurs. A future launch requires the owner's selected opening and reviewed initialScene/initialFacts through the real shared GM.
