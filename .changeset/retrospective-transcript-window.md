---
'vouchington-tooling': minor
---

Scope the retrospective transcript facts to the window since the session's previous retrospective.
`runRetrospectiveTranscript` and `computeTranscriptFacts` take optional `since` (exclusive) and
`until` (inclusive) bounds, `vouchington retrospective-transcript` gains `--since` and `--until`,
and `retrospective_check` / `retrospective_save` default `since` to the newest earlier
retrospective using the same journal boundary as the CI and sandbox sections (also overridable via
`compose.transcript.since` / `until`). A windowed report adds `Window:` and `Excluded: N events
outside the window` lines; a session with no earlier retrospective is unchanged.
