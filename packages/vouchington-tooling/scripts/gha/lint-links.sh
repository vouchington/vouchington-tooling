#!/usr/bin/env bash
# Two-pass Markdown link check. Pass 1: internal relative links and #anchors
# fail the job. Pass 2: external http/https links warn only.
set -euo pipefail

explicit_offline=false
options=()
files=()
globs=()
config="lychee.toml"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --offline=true | --offline)
      explicit_offline=true
      shift
      ;;
    --offline=false)
      shift
      ;;
    --config)
      [ "$#" -ge 2 ] || {
        echo "lint-links: --config requires a path" >&2
        exit 2
      }
      config="$2"
      shift 2
      ;;
    --glob)
      [ "$#" -ge 2 ] || {
        echo "lint-links: --glob requires a pattern" >&2
        exit 2
      }
      globs+=("$2")
      shift 2
      ;;
    --)
      shift
      files+=("$@")
      break
      ;;
    -*)
      options+=("$1")
      shift
      ;;
    *)
      if [[ "$1" == *.md && -f "$1" ]]; then
        files+=("$1")
      else
        options+=("$1")
      fi
      shift
      ;;
  esac
done

if [ "${#files[@]}" -eq 0 ]; then
  if [ "${#globs[@]}" -eq 0 ]; then
    globs=('*.md')
  fi
  while IFS= read -r -d '' file; do
    if [ -f "$file" ]; then
      files+=("$file")
    fi
  done < <(git ls-files -z -- "${globs[@]}")
fi

if [ "${#files[@]}" -eq 0 ]; then
  echo "No tracked Markdown files found"
  exit 0
fi

base=(lychee --config "$config")
if [ "${#options[@]}" -gt 0 ]; then
  base+=("${options[@]+"${options[@]}"}")
fi

echo "::group::Internal link check (relative paths + anchors)"
"${base[@]}" --offline --include-fragments -- "${files[@]}"
echo "::endgroup::"

if [ "$explicit_offline" = "true" ]; then
  exit 0
fi

echo "::group::External link check (warn-only)"
if ! "${base[@]}" --scheme http --scheme https -- "${files[@]}"; then
  echo "::endgroup::"
  echo "::warning title=External link check::External link(s) failed (non-blocking) — see the 'External link check' group above."
  exit 0
fi
echo "::endgroup::"
