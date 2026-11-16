#!/usr/bin/env -S python3 -I
"""One hook-harness wait for the triage loop.

Reads the loop configuration (.triage-loop.json in the launch directory, or the path in
TRIAGE_LOOP_CONFIG) and the stored cursor, waits once over the configured repositories, writes the
result to <stateDir>/hh-last.json, prints one summary line per event, and exits. It never advances
the cursor: run `state.py advance-hh` after the events are handled.

Main-branch failures come from workflow_run only; pull-request checks are left to pr-shepherd.
Event payloads are untrusted data.
"""
import json, os, subprocess, sys, tempfile

PRESETS = "ejection,dependabot-pr,/shepherd,/plan,/fix"
FIELDS = ("id", "repo", "event", "action", "prs", "issue", "reason", "conclusion", "workflow",
          "runId", "command", "commentId", "headSha", "headRef", "receivedAt")


def fail(message):
    sys.exit(f"triage-loop wait: {message}")


def config():
    path = os.environ.get("TRIAGE_LOOP_CONFIG") or ".triage-loop.json"
    try:
        with open(os.path.expanduser(path)) as f:
            value = json.load(f)
    except (OSError, ValueError) as error:
        fail(f"config {path}: {error}")
    for key in ("org", "repoPrefix", "stateDir"):
        if not isinstance(value.get(key), str):
            fail(f"config {path}: {key} must be a string")
    return value


def repositories(cfg):
    listed = subprocess.run(
        ["gh", "api", "--paginate", f"orgs/{cfg['org']}/repos?per_page=100",
         "--jq", ".[] | select(.archived | not) | .name"],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    excluded = set(cfg.get("excludedRepos") or [])
    names = sorted(n for n in listed if n.startswith(cfg["repoPrefix"]) and n not in excluded)
    if not names:
        fail("no repositories match the configuration")
    return [f"{cfg['org']}/{name}" for name in names]


def cursor(state_dir):
    try:
        with open(os.path.join(state_dir, "state.json")) as f:
            return ((json.load(f).get("hookHarness") or {}).get("cursor")) or ""
    except FileNotFoundError:
        return ""


def main():
    cfg = config()
    wait = cfg.get("eventWait") or {}
    state_dir = os.path.expanduser(cfg["stateDir"])
    os.makedirs(state_dir, exist_ok=True)
    after = cursor(state_dir)
    command = [
        "npx", "-y", f"hook-harness@{wait.get('hookHarness', '0.3.5')}", "wait",
        "--owner", cfg["org"], *(["--after", after] if after else ["--since", "10m"]),
        "--repo", ",".join(repositories(cfg)), "--on", PRESETS,
        "--event", "workflow_run", "--action", "completed", "--conclusion", "failure",
        "--branch", "main", "--timeout", os.environ.get("HH_TIMEOUT") or wait.get("timeout", "2h"),
    ]
    fd, tmp = tempfile.mkstemp(dir=state_dir, prefix=".hh-last.", suffix=".json")
    with os.fdopen(fd, "w") as out:
        code = subprocess.run(command, stdout=out, cwd=tempfile.gettempdir()).returncode
    if code != 0:
        os.unlink(tmp)
        sys.exit(code)
    result = os.path.join(state_dir, "hh-last.json")
    os.replace(tmp, result)
    with open(result) as f:
        data = json.load(f)
    print(json.dumps({k: v for k, v in data.items() if k not in ("events", "cursor")}))
    for event in data.get("events", []):
        line = {k: event.get(k) for k in FIELDS}
        line["sender"] = (event.get("sender") or {}).get("login")
        print(json.dumps(line))


if __name__ == "__main__":
    main()
