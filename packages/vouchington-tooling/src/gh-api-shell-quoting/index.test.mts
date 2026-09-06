import { describe, expect, it } from 'vitest'

import { shellScriptViolations, workflowYamlViolations } from './index.mts'

describe('gh api shell-quoting', () => {
  it('flags an unquoted `?` right after the gh api argument starts', () => {
    expect(shellScriptViolations('gh api repos/x/y?a=1&b=2\n')).toHaveLength(1)
  })

  it('flags an unquoted `&` that would silently background the command', () => {
    expect(shellScriptViolations('gh api "repos/x/labels" -f name=foo&color=bar\n')).toHaveLength(1)
  })

  it('stays silent on a fully double-quoted URL carrying both `?` and `&`', () => {
    expect(shellScriptViolations('gh api "repos/x/y?a=1&b=2"\n')).toEqual([])
  })

  it('stays silent on a fully single-quoted URL carrying both `?` and `&`', () => {
    expect(shellScriptViolations("gh api 'repos/x/y?a=1&b=2'\n")).toEqual([])
  })

  it('stays silent on a `${{ }}` expression with no query string', () => {
    expect(shellScriptViolations('gh api "repos/${{ github.repository }}/labels"\n')).toEqual([])
  })

  it('stays silent on a `?` that only appears inside a trailing comment', () => {
    expect(shellScriptViolations('gh api "repos/x/y" # example: ?recursive=1\n')).toEqual([])
  })

  it('stays silent on a legitimate `&&` operator after a quoted call', () => {
    expect(shellScriptViolations('gh api "repos/x/y" && echo done\n')).toEqual([])
  })

  it('stays silent on a legitimate standalone `&` backgrounding a fully-quoted call', () => {
    // A `&` preceded by whitespace ends a complete, fully-quoted command by backgrounding it —
    // Bash treats it like `&&` here, not as an unsafe argument character.
    expect(shellScriptViolations('gh api "repos/x/y" &\n')).toEqual([])
  })

  it('stays silent on a `2>&1` redirect after a fully-quoted call', () => {
    // The `&` here immediately follows `>`, making this a file-descriptor-duplication redirect
    // (`2>&1`), not an unsafe argument character.
    expect(shellScriptViolations('gh api "repos/x/y" >/dev/null 2>&1\n')).toEqual([])
  })

  it('stays silent on a `>&2` redirect after a fully-quoted call', () => {
    expect(shellScriptViolations('gh api "repos/x/y" >&2\n')).toEqual([])
  })

  it('does not flag a `gh api` substring that is not a standalone command', () => {
    // "foogh api …" has no word boundary before "gh api", so this must not match the head at all —
    // proves the boundary check, not just the head regex, gates a match.
    expect(shellScriptViolations('foogh api repos/x/y?a=1\n')).toEqual([])
  })

  it('joins a backslash-continued call before scanning it', () => {
    const source = 'gh api \\\n  "repos/x/y?a=1&b=2" \\\n  --jq .id\n'
    expect(shellScriptViolations(source)).toEqual([])
  })

  it('does not join two lines across an escaped, even-count trailing backslash', () => {
    // Two trailing backslashes are one escaped backslash character, not bash line continuation, so
    // the next physical line starts a fresh logical line with no `gh api` head — the query string
    // on it is never scanned as this call's argument.
    const source = 'gh api "repos/x" \\\\\n?a=1&b=2\n'
    expect(shellScriptViolations(source)).toEqual([])
  })

  it('scans a final line with no trailing newline', () => {
    expect(shellScriptViolations('gh api repos/x/y?a=1')).toHaveLength(1)
  })

  it('treats a backslash-escaped character as consumed, not a query-string separator', () => {
    const source = 'gh api repos/x/y\\?a=1&b=2\n'
    expect(shellScriptViolations(source)).toHaveLength(1)
  })

  it('stops scanning a call once a `|` pipes it into another command', () => {
    expect(shellScriptViolations('gh api "x" | grep ?\n')).toEqual([])
  })

  it('stops scanning a call once a `;` ends it', () => {
    expect(shellScriptViolations('gh api "x"; echo ?\n')).toEqual([])
  })

  it('closes an unquoted arithmetic substitution on its own matching parens', () => {
    // `$((1+2))` opens a substitution frame at `$(`, then the inner `(` and `)` are unquoted
    // parens tracked by that frame's own depth counter, independent of the `$(...)` that encloses
    // them — proves depth tracking (not just detecting the opening `$(`) gates the frame pop.
    const source = 'X=$((1+2)); gh api "repos/x/y?a=1&b=2"\n'
    expect(shellScriptViolations(source)).toEqual([])
  })

  it('stays silent on the real artifact-lookup call shape from a CI script', () => {
    const source =
      'artifacts_json=$(gh api --method GET ' +
      '"repos/$GITHUB_REPOSITORY/actions/artifacts?name=ci-state-$TESTED_SHA")\n'
    expect(shellScriptViolations(source)).toEqual([])
  })

  it('stays silent on the real paginated-runs call shape from a CI script', () => {
    const source =
      'prior_runs_pages=$(gh api --paginate --slurp --method GET ' +
      '"repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs' +
      '?event=pull_request&head_sha=$HEAD_SHA&per_page=100") &&\n'
    expect(shellScriptViolations(source)).toEqual([])
  })

  it('flags an unquoted `&` inside a `$(...)` substitution even when the substitution is quoted', () => {
    // `VAR="$(gh api ...)"`: double quotes around the substitution do not quote what happens
    // inside it — that context has its own, independent quoting — so the unquoted `&` here still
    // backgrounds the inner command.
    const source = 'PR_JSON="$(gh api repos/x/y?a=1&b=2)"\n'
    expect(shellScriptViolations(source)).toHaveLength(1)
  })

  it('stays silent when the URL inside a `$(...)` substitution is itself quoted', () => {
    const source = 'PR_JSON="$(gh api "repos/x/y?a=1&b=2")"\n'
    expect(shellScriptViolations(source)).toEqual([])
  })

  it('stays silent on a nested `$(...)` substitution with a quoted inner URL', () => {
    const source = 'PR_JSON="$(echo "$(gh api "repos/x/y?a=1&b=2")")"\n'
    expect(shellScriptViolations(source)).toEqual([])
  })

  it('reports the correct file line for a workflow run: block violation', () => {
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: |',
      '          gh api repos/x/y?a=1',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([{ line: 6, excerpt: expect.any(String) }])
  })

  it('stays silent on a compliant multi-line workflow run: block', () => {
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: |',
      '          gh api --method GET \\',
      '            "repos/x/y?a=1&b=2" \\',
      '            --jq .id',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([])
  })

  it('reports a violation folded across two source lines of a run: >- block', () => {
    // YAML folding joins these two source lines with a space before the shell ever sees them, so
    // `gh api` and the unquoted query form one unsafe command at runtime even though they sit on
    // separate lines in the file. The reported line is the `run: >-` block's start line, since
    // folding discards the source line breaks a hit's offset would otherwise map back through.
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: >-',
      '          gh api',
      '          repos/x/y?a=1&b=2',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([{ line: 5, excerpt: expect.any(String) }])
  })

  it('stays silent on a compliant run: >- folded block', () => {
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: >-',
      '          gh api',
      '          "repos/x/y?a=1&b=2"',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([])
  })

  it('reports a violation hidden by a single-quoted YAML flow scalar', () => {
    // YAML strips these outer quotes before the shell ever sees the value, so the shell-level
    // argument is bare `repos/x/y?a=1&b=2` even though the source line looks quoted. Scanning the
    // raw source slice (which still includes the `'…'` delimiters) would make the shell scanner
    // mistake them for argument quoting and miss this.
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      "        run: 'gh api repos/x/y?a=1&b=2'",
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([{ line: 5, excerpt: expect.any(String) }])
  })

  it('reports a violation hidden by a double-quoted YAML flow scalar', () => {
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: "gh api repos/x/y?a=1&b=2"',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([{ line: 5, excerpt: expect.any(String) }])
  })

  it('stays silent when the shell argument is itself quoted inside a single-quoted YAML flow scalar', () => {
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: \'gh api "repos/x/y?a=1&b=2"\'',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([])
  })

  it('stays silent when the shell argument is itself quoted inside a double-quoted YAML flow scalar', () => {
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: "gh api \'repos/x/y?a=1&b=2\'"',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([])
  })

  it('throws when a `run:` value is a YAML alias to a string scalar', () => {
    // An aliased `run:` value would otherwise bypass this guard silently, since the current
    // detection only understands Scalar nodes at a `run:` pair — a loud failure is the correct
    // response to an invariant this guard cannot yet enforce.
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: A',
      '        run: &shared |',
      '          gh api "repos/x/y"',
      '      - name: B',
      '        run: *shared',
      '',
    ].join('\n')
    expect(() => workflowYamlViolations(source)).toThrow(/YAML alias/)
  })

  it('silently skips a `run:` value that is a YAML alias to a non-string scalar', () => {
    // The alias branch only throws when the resolved node is a *string* scalar (the only shape that
    // could plausibly be a shell body). An alias to a number, boolean, or other non-string scalar has
    // no shell semantics as a run: value, so it is skipped rather than throwing — distinct from the
    // alias-to-a-string-scalar throw case above.
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: A',
      '        timeout-minutes: &t 5',
      '      - name: B',
      '        run: *t',
      '',
    ].join('\n')
    expect(workflowYamlViolations(source)).toEqual([])
  })

  it('throws when the source is not valid YAML', () => {
    // Tabs are illegal as YAML indentation; parseDocument records this as a document error rather
    // than throwing itself, so runBlocks must surface it instead of silently treating the document
    // as having no run: blocks.
    const source = 'jobs:\n\tbuild: 1\n'
    expect(() => workflowYamlViolations(source)).toThrow()
  })

  it('stays silent on a `run:` value that is a YAML collection, not a scalar', () => {
    // A flow sequence has no shell semantics as a run: body — isScalar(pair.value) is false, so this
    // is skipped the same way an alias-to-a-collection is, just without going through isAlias first.
    const source = ['jobs:', '  build:', '    steps:', '      - run: [a, b]', ''].join('\n')
    expect(workflowYamlViolations(source)).toEqual([])
  })

  it('stays silent on a `run:` value that is a non-string scalar, not an alias', () => {
    // A bare number has no shell semantics as a run: body — isScalar(pair.value) is true but its
    // value is not a string, distinct from the alias-to-a-non-string-scalar skip covered above.
    const source = ['jobs:', '  build:', '    steps:', '      - run: 42', ''].join('\n')
    expect(workflowYamlViolations(source)).toEqual([])
  })

  it('throws when a `run:` value is a multiline PLAIN scalar', () => {
    // A PLAIN scalar (no quotes, no `|`/`>` block indicator) can still span multiple source lines —
    // YAML folds the line break into a single space before the shell ever sees it. Scanning the raw
    // source slice instead (as this guard does for single-line PLAIN) leaves an un-joined `\n` with
    // no trailing backslash, so the scanner treats the continuation as an unrelated logical line and
    // silently misses a `gh api` call split across the fold — a loud failure is the correct response
    // until multiline PLAIN decoding is added.
    const source = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Query',
      '        run: gh api',
      '          repos/x/y?a=1&b=2',
      '',
    ].join('\n')
    expect(() => workflowYamlViolations(source)).toThrow(/multiline PLAIN/)
  })
})
