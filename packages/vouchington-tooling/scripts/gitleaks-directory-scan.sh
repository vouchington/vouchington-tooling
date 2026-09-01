#!/usr/bin/env bash
set -euo pipefail
CDPATH=''

config_path=''
repo_root=$(pwd -P)
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) config_path=${2:?--config requires a path}; shift 2 ;;
    --root) repo_root=${2:?--root requires a path}; shift 2 ;;
    *) echo "unknown gitleaks-directory-scan option: $1" >&2; exit 2 ;;
  esac
done
for command_name in git gitleaks tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required but was not found on PATH" >&2; exit 127;
  }
done
[ -n "$config_path" ] || { echo '--config requires a path' >&2; exit 2; }
case "$config_path" in /*|*'..'*|*'//'*) echo '--config must be a repository-relative path' >&2; exit 2 ;; esac
repo_root=$(cd -- "$repo_root" && pwd -P)
[ -f "$repo_root/$config_path" ] || {
  echo "required Gitleaks config is missing: $repo_root/$config_path" >&2; exit 1;
}
scratch_dir=$(mktemp -d "${TMPDIR:-/tmp}/gitleaks-directory.XXXXXX")
cleanup() { [ -n "${scratch_dir:-}" ] && rm -rf -- "$scratch_dir"; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
index_dir="$scratch_dir/index"
working_dir="$scratch_dir/working"
mkdir -p "$index_dir" "$working_dir"
git -C "$repo_root" checkout-index --all --prefix="$index_dir/"
index_config_path="$index_dir/$config_path"
[ -f "$index_config_path" ] || {
  echo "required staged Gitleaks config is missing: $config_path" >&2; exit 1;
}
git -C "$repo_root" ls-files --cached --others --exclude-standard -z |
  while IFS= read -r -d '' candidate_path; do
    if [ -e "$repo_root/$candidate_path" ] || [ -L "$repo_root/$candidate_path" ]; then
      printf '%s\0' "$candidate_path"
    fi
  done |
  tar -C "$repo_root" --null -T - -cf - |
  tar -C "$working_dir" -xf -
scan_directory() ( cd -- "$1"; gitleaks dir --config "$2" --redact=100 .; )
scan_directory "$index_dir" "$index_config_path"
scan_directory "$working_dir" "$working_dir/$config_path"
