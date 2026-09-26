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
| ---- | ------ | ----- |

`jscpd-wiring.test.mts` fails when a configured ignore glob is missing from this document.
