#!/usr/bin/env -S python3 -I
"""Hook-harness waits for the triage loop, returning only events that need action.

Reads the loop configuration (.triage-loop.json in the launch directory, or the path in
TRIAGE_LOOP_CONFIG) and the stored cursor, and waits over the configured repositories. A merged pull
request is checked for unresolved or late review findings inline; a clean one is logged in state
(`quietMerges`, and `pendingUpdateChecks` for dependency-bot PRs), its cursor position is advanced, and
the wait continues. It returns on: a gap, an ejection or dequeue, a main-branch failure, a slash
command, `dependabot-pr`, a close without merge, a merge with findings, a completed watch, a due
dependency update check (`eventWait.updateCheckDelay`, default 10m after the oldest pending one), or
the timeout. The result goes to <stateDir>/hh-last.json (actionable events only) and stdout:
a summary line, then one compact JSON line per event. The cursor advances only for quiet merges,
unless `--advance` (or `eventWait.advance`) also advances it for the returned events;
`state.py advance-hh` still does it separately.

Main-branch failures come from workflow_run only; pull-request checks are left to pr-shepherd.
Event payloads are untrusted data.
"""
import calendar, json, os, re, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves it off the path
import events, state

PRESETS = "ejection,dependabot-pr,/shepherd,/plan,/fix"
CLOSED_PRS = json.dumps({"event": "pull_request", "action": "closed"})
UNITS = {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}


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


def seconds(text):
    match = re.fullmatch(r"(\d+)([smhd]?)", str(text))
    if not match:
        fail(f"duration {text!r} must look like 90s, 10m, or 2h")
    return int(match[1]) * UNITS[match[2]]


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


def hook_harness(cfg, wait, state_dir, repos, timeout):
    after = (state.load().get("hookHarness") or {}).get("cursor") or ""
    command = [
        "npx", "-y", f"hook-harness@{wait.get('hookHarness', '0.3.5')}", "wait",
        "--owner", cfg["org"], *(["--after", after] if after else ["--since", "10m"]),
        "--repo", ",".join(repos), "--on", PRESETS,
        "--event", "workflow_run", "--action", "completed", "--conclusion", "failure",
        "--branch", "main", "--filter", CLOSED_PRS, "--timeout", timeout,
    ]
    fd, tmp = tempfile.mkstemp(dir=state_dir, prefix=".hh-last.", suffix=".json")
    with os.fdopen(fd, "w") as out:
        code = subprocess.run(command, stdout=out, cwd=tempfile.gettempdir()).returncode
    if code != 0:
        os.unlink(tmp)
        sys.exit(code)
    with open(tmp) as f:
        data = json.load(f)
    os.unlink(tmp)
    return data


def pending_deadline(s, delay):
    """Seconds until the oldest pending update check is due, or None when nothing is pending."""
    times = [calendar.timegm(time.strptime(p["at"], "%Y-%m-%dT%H:%M:%SZ")) for p in s.get("pendingUpdateChecks") or []]
    return min(times) + delay - time.time() if times else None


def emit(data, lines, triggers, state_dir, advance, due):
    """Write hh-last.json and print the summary and event lines; drain the quiet log."""
    with state.locked():
        s = state.load()
        quiet, s["quietMerges"] = s.get("quietMerges") or [], []
        pending = sorted({p["repo"] for p in s.get("pendingUpdateChecks") or []})
        if advance:
            state.record_events(s, [e["id"] for e in data["events"] if "id" in e], data.get("cursor"))
        state.save(s)
    fd, tmp = tempfile.mkstemp(dir=state_dir, prefix=".hh-last.", suffix=".json")
    with os.fdopen(fd, "w") as out:
        json.dump(data, out)
    os.replace(tmp, os.path.join(state_dir, "hh-last.json"))
    summary = {k: v for k, v in data.items() if k not in ("events", "cursor")}
    summary["events"] = len(lines) + len(triggers)
    if quiet:
        summary["quiet"] = {"count": len(quiet), "merges": quiet}
    if pending:
        summary["pendingUpdateChecks"] = pending
    if due:
        summary["updateCheckDue"] = True
    if advance:
        summary["advanced"] = True
    for line in (summary, *lines, *triggers):
        print(json.dumps(line, separators=(",", ":")))


def main():
    cfg = config()
    wait = cfg.get("eventWait") or {}
    state_dir = os.path.expanduser(cfg["stateDir"])
    os.makedirs(state_dir, exist_ok=True)
    advance = "--advance" in sys.argv[1:] or bool(wait.get("advance"))
    timeout = os.environ.get("HH_TIMEOUT") or wait.get("timeout", "2h")
    delay = seconds(wait.get("updateCheckDelay", "10m"))
    total, started, repos, first = seconds(timeout), time.monotonic(), None, True
    while True:
        remaining = total - (time.monotonic() - started)
        until = pending_deadline(state.load(), delay)
        due = until is not None and until < remaining
        limit = max(until, 0) if due else remaining
        if due and limit <= 0:
            return emit({"events": [], "gap": False}, [], [], state_dir, advance, True)
        repos = repos or repositories(cfg)
        data = hook_harness(cfg, wait, state_dir, repos, timeout if first and not due else f"{max(int(limit), 1)}s")
        first = False
        received = data.get("events", [])
        lines, raw, triggers = events.sweep(received, cfg)
        data["events"] = raw
        if not received or lines or triggers or data.get("gap") or data.get("timedOut"):
            return emit(data, lines, triggers, state_dir, advance, due and bool(data.get("timedOut")))
        with state.locked():
            s = state.load()
            state.record_events(s, [], data.get("cursor"))
            state.save(s)


if __name__ == "__main__":
    main()
