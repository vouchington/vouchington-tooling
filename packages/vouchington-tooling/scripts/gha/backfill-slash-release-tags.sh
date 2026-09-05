#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: backfill-slash-release-tags.sh --package NAME [--package NAME] [--dry-run] [--push] [--remote NAME]" >&2
}

packages=()
dry_run=0
do_push=0
remote=origin

while [ $# -gt 0 ]; do
  case "$1" in
    --package)
      [ $# -ge 2 ] || { usage; exit 2; }
      packages+=("$2")
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --push)
      do_push=1
      shift
      ;;
    --remote)
      [ $# -ge 2 ] || { usage; exit 2; }
      remote="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ "${#packages[@]}" -eq 0 ]; then
  usage
  exit 2
fi

if [ "$dry_run" -eq 1 ] && [ "$do_push" -eq 1 ]; then
  echo "cannot combine --dry-run and --push" >&2
  exit 2
fi

semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
push_refs=()

for package in "${packages[@]}"; do
  if [[ ! "$package" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "invalid package name: ${package}" >&2
    exit 2
  fi

  while IFS= read -r hyphen_tag; do
    [ -n "$hyphen_tag" ] || continue
    version="${hyphen_tag#"${package}-v"}"
    if [[ ! "$version" =~ $semver ]]; then
      echo "hyphen tag ${hyphen_tag} is not <package>-v<semver>" >&2
      exit 1
    fi

    slash_tag="${package}/v${version}"
    commit="$(git rev-parse "${hyphen_tag}^{commit}")"

    if git rev-parse -q --verify "refs/tags/${slash_tag}" >/dev/null; then
      existing="$(git rev-parse "${slash_tag}^{commit}")"
      if [ "$existing" != "$commit" ]; then
        echo "slash tag ${slash_tag} points at ${existing}, expected ${commit}" >&2
        exit 1
      fi
      echo "skip ${slash_tag} (already at ${commit})"
      continue
    fi

    echo "create ${slash_tag} -> ${commit}"
    if [ "$dry_run" -eq 0 ]; then
      git tag -a "${slash_tag}" -m "${package} v${version}" "$commit"
      push_refs+=("refs/tags/${slash_tag}")
    fi
  done < <(git tag --list "${package}-v*")
done

if [ "$do_push" -eq 0 ]; then
  exit 0
fi

if [ "${#push_refs[@]}" -eq 0 ]; then
  echo "nothing to push"
  exit 0
fi

git push --atomic "$remote" "${push_refs[@]}"
