// Extracts and scans `run:` step bodies from a GitHub Actions workflow or composite-action YAML
// document for the same unquoted `?`/`&` hazard `./scan.mts` detects in a plain shell script. See
// ./index.mts for the exported entry points.
import { isAlias, isScalar, parseDocument, visit } from 'yaml'

import { ghApiShellQuotingHits, lineNumberAt } from './scan.mts'

export type ShellQuotingViolation = { line: number; excerpt: string }

// Any `run:` scalar anywhere in the document is a shell step body — workflow job steps and
// composite-action steps both use the same key. This module does not resolve YAML aliases: a
// `run:` value has no reason to be shared via an anchor, so instead of silently skipping an
// aliased `run:` (which would let an unsafe invocation bypass detection undetected), `runBlocks`
// throws when it finds one — see below.
//
// A folded scalar (`run: >-`) joins its source lines with spaces before the shell ever sees it, so
// `gh api` on one physical line and an unquoted `repos/x/y?a=1&b=2` on the next form one unsafe
// command at runtime even though they are two lines in the file. A quoted flow scalar
// (`run: 'gh api …?a=1&b=2'` or `run: "gh api …?a=1&b=2"`) has its outer quotes stripped by YAML
// before the shell ever sees it too, so scanning the raw source slice — which still includes those
// quotes — makes the shell scanner mistake them for argument quoting and miss a real violation.
// `text` is the already-decoded string for these shapes (`pair.value.value`, not the raw source
// slice, which still carries the block header or quote delimiters) so the scanner sees exactly
// what the shell would; `decoded` tells the caller that per-hit offsets inside `text` no longer
// correspond 1:1 to source byte offsets, since decoding discards those delimiters (and, for folded
// scalars, the original line breaks). `BLOCK_LITERAL` (`run: |`) and single-line `PLAIN` scalars
// keep their raw source slice: both scan identically decoded or not, so precise per-hit offsets
// stay correct and existing per-line assertions are unaffected. A *multiline* `PLAIN` scalar folds
// its line breaks the same way a folded scalar does, so its raw slice is not equivalent to what
// the shell sees either — worse, the raw slice's un-joined `\n` (with no trailing backslash) makes
// `ghApiShellQuotingHits` treat the continuation as an unrelated logical line, silently missing a
// `gh api` call split across it (see below). `runBlocks` throws on this shape below rather than
// decode it, mirroring the alias handling above.
const DECODED_SCALAR_TYPES: ReadonlySet<string> = new Set([
  'BLOCK_FOLDED',
  'QUOTE_SINGLE',
  'QUOTE_DOUBLE',
])

function runBlocks(source: string): Array<{ offset: number; text: string; decoded: boolean }> {
  const document = parseDocument(source)
  if (document.errors.length > 0) throw document.errors[0]
  const blocks: Array<{ offset: number; text: string; decoded: boolean }> = []
  visit(document, {
    Pair(_key, pair) {
      if (!isScalar(pair.key) || pair.key.value !== 'run') return
      if (isAlias(pair.value)) {
        const resolved = pair.value.resolve(document)
        if (isScalar(resolved) && typeof resolved.value === 'string') {
          throw new Error(
            'run: value is a YAML alias to a string scalar — this guard does not resolve ' +
              'aliases, so an aliased shell body could bypass it undetected. Write the run: ' +
              'value inline, or extend runBlocks() to resolve aliases before adding one.',
          )
        }
        return
      }
      if (!isScalar(pair.value) || typeof pair.value.value !== 'string') return
      /* v8 ignore next -- parseDocument always assigns a range to a scalar it parsed from source;
         this only guards the type narrowing above, not a reachable runtime state. */
      if (!pair.value.range) throw new Error('run: scalar has no source range')
      const raw = source.slice(pair.value.range[0], pair.value.range[1])
      if (pair.value.type === 'PLAIN' && raw.includes('\n')) {
        throw new Error(
          'run: value is a multiline PLAIN scalar — its raw source slice does not match the ' +
            'decoded shell text (YAML folds a PLAIN line break into a single space), and this ' +
            'guard only decodes BLOCK_FOLDED/QUOTE_SINGLE/QUOTE_DOUBLE scalars, so scanning the ' +
            'raw slice can silently miss a call split across the fold. Rewrite the run: value as ' +
            'a quoted or block scalar, or extend DECODED_SCALAR_TYPES and runBlocks() to decode ' +
            'multiline PLAIN scalars before adding one.',
        )
      }
      const decoded = pair.value.type !== undefined && DECODED_SCALAR_TYPES.has(pair.value.type)
      blocks.push({
        offset: pair.value.range[0],
        text: decoded ? pair.value.value : raw,
        decoded,
      })
    },
  })
  return blocks
}

/** For a workflow/composite-action YAML file: scans every `run:` block's effective shell text. */
export function workflowYamlViolations(source: string): ShellQuotingViolation[] {
  const violations: ShellQuotingViolation[] = []
  for (const block of runBlocks(source)) {
    const blockStartLine = lineNumberAt(source, block.offset)
    for (const hit of ghApiShellQuotingHits(block.text)) {
      // A decoded block's delimiters (and, for folded blocks, its line breaks) are gone by the
      // time the shell runs it, so there is no single source line the hit "belongs" to — report
      // the block's start line instead of computing a byte offset into decoded text that no
      // longer lines up with `source`.
      violations.push({
        line: block.decoded ? blockStartLine : lineNumberAt(source, block.offset + hit.offset),
        excerpt: hit.excerpt,
      })
    }
  }
  return violations
}
