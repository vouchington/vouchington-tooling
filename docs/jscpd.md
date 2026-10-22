# jscpd clone-size threshold

The gate is the plain [jscpd](https://github.com/kucherenko/jscpd) CLI, `jscpd .`, configured by
[`.jscpd.json`](../.jscpd.json). `pnpm run lint` runs it through the `jscpd` package script, and CI
runs that lint script.

The configured thresholds are `"minLines": 200` and `"similarity": 0.85`. `"exitCode": 1` makes
jscpd fail when it finds any clone at or above that size. A clone is one duplicated block shared by two files. There is no baseline and no
base-branch comparison, so a pull request and `main` judge the whole tree the same way.

`"similarity": 0.85` also reports JavaScript and TypeScript function pairs whose AST similarity
reaches 85%, ignoring identifier names and literal values. `minLines` applies to both exact and
similar clones. SQL, Bash, and CSS stay exact-only. A whole-tree preview at similarity 0.85 and
`minLines` 200 reported 0 clones before this value moved.

Blocks shorter than the threshold are not reported. jscpd skips files shorter than `minLines`, so
the threshold bounds the scan as well as the report. `failOnEmpty` fails a run that analyzes no
files, which catches an ignore list that swallows the whole tree.

The threshold only moves down. Preview a lower value with `pnpm exec jscpd . --min-lines <N>`,
deduplicate what it flags, then lower `minLines` here and in `.jscpd.json` in the same change.

## Scope

`.jscpd.json` scans TypeScript, TSX, JavaScript, SQL, Bash, and CSS. `crossFormats` is
`typescript,tsx`, so clones can match across those two. jscpd respects `.gitignore`.

jscpd scans the working tree, not `git ls-files`. CI checks out a clean tree. Locally, an untracked
file that `.gitignore` does not cover is scanned too. An untracked file can only add clones, so it
can fail a local run and cannot hide one.

`**/fixtures/**` is ignored because fixture data repeats shapes on purpose. No other exceptions are
configured.

| Glob | Reason | Owner |

`jscpd-wiring.test.mts` fails when a configured ignore glob is missing from this document.

## Dead-code baseline gate

`vouchington dead-code` (library: `vouchington-tooling/dead-code`) runs `jscpd --dead-code` over a
snapshot of the tracked working tree and compares the findings with a committed baseline of accepted
identities. Untracked importers and `.gitignore` cannot mask an orphan, because only `git ls-files`
paths are copied. New findings fail the run; a shrunk baseline fails `check` until it is updated.

```bash
vouchington dead-code --baseline dead-code-baseline.json --seed     # first adoption only
vouchington dead-code --baseline dead-code-baseline.json            # check
vouchington dead-code --baseline dead-code-baseline.json --update   # drop fixed findings
```

- `--baseline <path>`: Required baseline file, relative to the repository root
- `--config <path>`: Tracked jscpd config. Default `.jscpd.json`
- `--binary <path>`: jscpd executable. Default `<repo>/node_modules/.bin/jscpd`
- `--repo-root <path>`: Repository to scan. Default the working directory
- `--entry <glob>`: Live entry root, repeatable. Default the config's `deadCode.entry`
- `--snapshot-ignore <glob>`: Tracked files left out of the snapshot, repeatable
- `--exclude <glob>`: Finding paths that are not counted, repeatable

Test and spec files and files used only by tests are never counted. Every entry root must be a
relative glob that matches a tracked file. A stale root fails the run.

This repository does not run the gate on itself yet. Adopting it needs a seeded baseline and a
`deadCode` section in `.jscpd.json`, which is left to a follow-up.
