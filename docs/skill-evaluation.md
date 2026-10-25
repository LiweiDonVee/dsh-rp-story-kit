# Asset adaptation skill validation

This checkpoint permits no subagent delegation or paid model calls. The following is a reference application scenario, not an independent behavioral benchmark.

## Scenario fixed before authoring

Input: the public synthetic two-opening setting card in `tests/fixtures/harbor-v2.json` and player input in `tests/fixtures/traveler-persona.json`. Request: import the setting, keep the second opening available, and prepare a lightweight player persona. The example dialogue says where the lighthouse is; it has never occurred in the new story. The source also carries author instructions, a literal macro, inert regex metadata and an embedded worldbook.

Expected observable artifact:

- A Character asset preserves setting fields, creator provenance, both openings and literal example dialogue.
- A Persona asset contains only the requested player identity, with a fresh ID/version from createPersona.
- Original bytes remain unchanged; author system text stays in source. No generated per-card files, preset or runtime.
- A worldbook descriptor points to the full original card and remains deferred if Database is absent.
- No Session event, GM facts, launch or “ready” declaration results from asset adaptation. The owner chooses initialScene/initialFacts separately.

## Application result

The worked artifact in `skills/adapting-roleplay-story-assets/references/behavior-example.md` applies those decisions. The production import/store tests execute the real byte preservation, opening mapping, examples separation, source-only instruction handling, settings-only acceptance and deferred Database path. UI tests use the real store/host and verify the setting and opening choices without a launch.

Structural validation uses the Codex skill-creator validator and the repository skill:check script. Packaging checks inspect the actual tgz for the entrypoint and both linked references. These checks establish structure and executable asset behavior; they do not establish independent model adherence or literary quality.
