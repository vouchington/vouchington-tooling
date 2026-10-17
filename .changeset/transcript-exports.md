---
'vouchington-tooling': minor
---

Export `normalizeCommandPrefix`, `splitCommandSegments`, `isPackageRunner`, `asRecord` and `asArray`
from the `retrospective-transcript` subpath, and add a streaming
`openTranscriptLines(path, { maxRecordBytes })` (default 2 MiB per record; an oversized record makes
the line iterable throw). `resolveTranscriptFile` is unchanged and now documented as canonical.
