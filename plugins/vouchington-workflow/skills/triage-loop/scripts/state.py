#!/usr/bin/env -S python3 -I
"""Typed, atomic updates to the triage loop's state.json.

The state directory comes from the loop configuration (.triage-loop.json in the launch directory,
or the path in TRIAGE_LOOP_CONFIG). Each command holds an exclusive lock on state.lock for its whole
read-modify-write, checks the shape of the fields it touches, and replaces state.json atomically.
Add a subcommand rather than editing state.json another way.
"""
import argparse, contextlib, datetime, fcntl, json, os, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves it off the path
import late_review, update_check

SEEN_MAX = 200
# The top-level fields and their shapes; `set`, `append`, and `remove` touch only these.
FIELDS = {
    "lastSweepAt": str, "commandsThrough": str, "reviewedComments": dict, "lateReview": dict, "schedule": dict,
    "retroCursor": str, "escalations": dict, "hookHarness": dict, "handledFailures": dict,
    "shepherds": dict, "intake": list, "scheduledPrompts": dict, "delegations": list,
    "routed": list, "watches": list, "quietMerges": list, "pendingUpdateChecks": list,
}


def config():
    path = os.environ.get("TRIAGE_LOOP_CONFIG") or ".triage-loop.json"
    try:
        with open(os.path.expanduser(path)) as f:
            value = json.load(f)
    except (OSError, ValueError) as error:
        sys.exit(f"triage-loop config {path}: {error}")
    if not isinstance(value, dict) or not isinstance(value.get("stateDir"), str):
        sys.exit(f"triage-loop config {path}: stateDir must be a string")
    return value


CONFIG = config()
DIR = os.path.expanduser(CONFIG["stateDir"])
STATE = os.path.join(DIR, "state.json")
HH_LAST = os.path.join(DIR, "hh-last.json")
HISTORY = (CONFIG.get("scheduledPrompts") or {}).get("history", 20)


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load():
    if not os.path.exists(STATE):
        return {}
    with open(STATE) as f:
        return expect(json.load(f), dict, "state.json")


def save(s):
    os.makedirs(DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DIR, prefix=".state.", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(s, f, indent=2)
        f.write("\n")
    os.replace(tmp, STATE)


@contextlib.contextmanager
def locked():
    os.makedirs(DIR, exist_ok=True)
    with open(os.path.join(DIR, "state.lock"), "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def parse_path(path):
    keys = path.split(".")
    if keys[0] not in FIELDS or not all(keys):
        sys.exit(f"state.py: {path!r} must start with one of {', '.join(sorted(FIELDS))}")
    return keys


def parent_of(s, keys, create):
    node = s
    for depth, key in enumerate(keys[:-1]):
        kind = FIELDS[key] if depth == 0 else dict
        if key not in node and create:
            node[key] = kind()
        node = expect(node.get(key), kind, ".".join(keys[: depth + 1]))
    return expect(node, dict, ".".join(keys[:-1]) or "state.json")


def set_value(a):
    keys = parse_path(a.path)
    value = json.loads(a.json)
    if len(keys) == 1:
        expect(value, FIELDS[keys[0]], keys[0])
    s = load()
    parent_of(s, keys, True)[keys[-1]] = value
    save(s)
    print(json.dumps({a.path: value}))


def append_value(a):
    keys = parse_path(a.path)
    s = load()
    parent = parent_of(s, keys, True)
    items = expect(parent.setdefault(keys[-1], []), list, a.path)
    items.append(json.loads(a.json))
    if a.keep:
        parent[keys[-1]] = items[-a.keep:]
    save(s)
    print(json.dumps({a.path: len(parent[keys[-1]])}))


def remove_value(a):
    keys = parse_path(a.path)
    s = load()
    removed = keys[0] in s and parent_of(s, keys, False).pop(keys[-1], None) is not None
    save(s)
    print(json.dumps({a.path: "removed" if removed else "absent"}))


def expect(value, kind, name):
    if not isinstance(value, kind):
        sys.exit(f"state.json: {name} must be {kind.__name__}, got {type(value).__name__}")
    return value


def record_events(s, ids, cursor):
    """Mark event ids seen and store the cursor, as `advance-hh` does for one wait result."""
    hh = expect(s.setdefault("hookHarness", {}), dict, "hookHarness")
    seen = expect(hh.setdefault("seen", []), list, "hookHarness.seen")
    seen.extend(i for i in ids if i not in seen)
    hh["seen"] = seen[-SEEN_MAX:]
    if cursor:
        hh["cursor"] = cursor


def advance_hh(_):
    s = load()
    with open(HH_LAST) as f:
        d = json.load(f)
    ids = [e["id"] for e in d.get("events", []) if "id" in e]
    record_events(s, ids, d.get("cursor"))
    save(s)
    print(json.dumps({"events": len(ids), "cursorAdvanced": bool(d.get("cursor"))}))


def late_review_cmd(a):
    failed = False
    for ref in a.refs:
        try:
            print(late_review.line(late_review.check(ref)))
        except late_review.LateReviewError as error:
            failed = True
            print(f"{ref} error: {error}")
    sys.exit(1 if failed else 0)


def update_check_script(a):
    try:
        print(update_check.script(a.org or CONFIG.get("org"), a.repo, a.dry), end="")
    except ValueError as error:
        sys.exit(f"update-check-script: {error}")


def watch(a):
    s = load()
    watches = expect(s.setdefault("watches", []), list, "watches")
    if a.action == "add":
        if not a.id or not a.pr or not a.notify:
            sys.exit("watch add needs --id, --notify, and at least one --pr")
        if any(w["id"] == a.id for w in watches):
            sys.exit(f"watch add: {a.id!r} already exists")
        for ref in a.pr:
            if not late_review.REF.match(ref):
                sys.exit(f"watch add: {ref!r} must look like owner/repo#N")
        try:
            merged = [ref for ref in a.pr if late_review.is_merged(ref)]
        except late_review.LateReviewError as error:
            sys.exit(f"watch add: {error}")
        watches.append({"id": a.id, "prs": a.pr, "notify": a.notify, "note": a.note or "", "at": now(),
                        "merged": sorted(r.lower() for r in merged)})
    elif a.action == "remove":
        watches[:] = [w for w in watches if w["id"] != a.id]
    elif a.action == "ack":
        hits = [w for w in watches if w["id"] == a.id]
        if not hits:
            sys.exit(f"watch ack: no watch {a.id!r}")
        hits[0]["ackedAt"] = now()
    if a.action != "list":
        save(s)
    print(json.dumps(watches))


def route(a):
    s = load()
    routed = expect(s.setdefault("routed", []), list, "routed")
    entry = {"what": a.what, "to": a.to, "at": now()}
    for k in ("evidence", "issue", "note"):
        if getattr(a, k):
            entry[k] = getattr(a, k)
    routed.append(entry)
    save(s)
    print(json.dumps(entry))


def annotate_route(a):
    s = load()
    routed = expect(s.get("routed", []), list, "routed")
    hits = [r for r in routed if a.match in r.get("what", "")]
    if len(hits) != 1:
        sys.exit(f"annotate-route: {len(hits)} entries match {a.match!r}; need exactly 1")
    hits[0]["note"] = a.note
    if a.issue:
        hits[0]["issue"] = a.issue
    save(s)
    print(json.dumps(hits[0]))


def sp_record(a):
    s = load()
    sp = expect(s.setdefault("scheduledPrompts", {}), dict, "scheduledPrompts")
    runs = expect(sp.setdefault("runs", []), list, "scheduledPrompts.runs")
    entry = {"prompt": a.prompt, "runId": a.run_id, "at": now(), "outcome": a.outcome}
    if a.pr:
        entry["pr"] = a.pr
    runs.append(entry)
    sp["runs"] = runs[-HISTORY:]
    sp["next"] = a.next
    save(s)
    print(json.dumps({"recorded": entry, "next": a.next}))


def sp_next(a):
    s = load()
    sp = expect(s.setdefault("scheduledPrompts", {}), dict, "scheduledPrompts")
    sp["next"] = a.next
    save(s)
    print(json.dumps({"next": a.next}))


def shepherd(a):
    s = load()
    sh = expect(s.setdefault("shepherds", {}), dict, "shepherds")
    if a.remove:
        sh.pop(a.pr, None)
    else:
        sh[a.pr] = {"by": a.by, "since": now(), "head": a.head, "category": a.category}
    save(s)
    print(json.dumps({a.pr: sh.get(a.pr)}))


def sweep_done(_):
    s = load()
    s["lastSweepAt"] = now()
    save(s)
    print(json.dumps({"lastSweepAt": s["lastSweepAt"]}))


def reviewed(a):
    s = load()
    rc = expect(s.setdefault("reviewedComments", {}), dict, "reviewedComments")
    with open(a.file) as f:
        add = expect(json.load(f), dict, "reviewed --file")
    for repo, ids in add.items():
        cur = expect(rc.setdefault(repo, []), list, f"reviewedComments.{repo}")
        have = {int(e["id"]) if isinstance(e, dict) else int(e) for e in cur}
        for i in ids:
            if int(i) not in have:
                cur.append({"id": int(i), "harvestedAt": now()})
                have.add(int(i))
    save(s)
    print(json.dumps({k: len(v) for k, v in rc.items()}))


def show(a):
    s = load()
    print(json.dumps(s.get(a.key) if a.key else sorted(s), indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("advance-hh", help="store the cursor and seen ids from hh-last.json").set_defaults(fn=advance_hh)
    r = sub.add_parser("route", help="record where an item was routed")
    r.add_argument("--what", required=True)
    r.add_argument("--to", required=True)
    r.add_argument("--evidence")
    r.add_argument("--issue")
    r.add_argument("--note")
    r.set_defaults(fn=route)
    n = sub.add_parser("annotate-route", help="annotate the one routed item that matches")
    n.add_argument("--match", required=True)
    n.add_argument("--note", required=True)
    n.add_argument("--issue")
    n.set_defaults(fn=annotate_route)
    x = sub.add_parser("sp-record", help="record a scheduled-prompt run and the next prompt")
    x.add_argument("--prompt", required=True)
    x.add_argument("--run-id", required=True)
    x.add_argument("--outcome", required=True)
    x.add_argument("--next", required=True)
    x.add_argument("--pr")
    x.set_defaults(fn=sp_record)
    x = sub.add_parser("sp-next", help="set the next scheduled prompt")
    x.add_argument("--next", required=True)
    x.set_defaults(fn=sp_next)
    x = sub.add_parser("shepherd", help="record or remove an in-flight shepherd")
    x.add_argument("--pr", required=True)
    x.add_argument("--remove", action="store_true")
    x.add_argument("--by", default="loop subagent")
    x.add_argument("--head")
    x.add_argument("--category")
    x.set_defaults(fn=shepherd)
    sub.add_parser("sweep-done", help="set lastSweepAt to now").set_defaults(fn=sweep_done)
    x = sub.add_parser("reviewed", help="add harvested comment ids from a {repo: [ids]} file")
    x.add_argument("--file", required=True)
    x.set_defaults(fn=reviewed)
    x = sub.add_parser("set", help="set a dotted path under a known field to a JSON value")
    x.add_argument("path")
    x.add_argument("--json", required=True)
    x.set_defaults(fn=set_value)
    x = sub.add_parser("append", help="append a JSON value to the list at a dotted path")
    x.add_argument("path")
    x.add_argument("--json", required=True)
    x.add_argument("--keep", type=int, help="keep only the newest N entries")
    x.set_defaults(fn=append_value)
    x = sub.add_parser("remove", help="remove the key at a dotted path")
    x.add_argument("path")
    x.set_defaults(fn=remove_value)
    x = sub.add_parser("late-review", help="report unresolved threads and late reviews for merged PRs")
    x.add_argument("refs", nargs="+", metavar="owner/repo#N")
    x.set_defaults(fn=late_review_cmd, lock=False)
    x = sub.add_parser("update-check-script", help="print the Check-for-updates browser script")
    x.add_argument("--repo", action="append", required=True, help="name or name:ecosystem[,ecosystem]")
    x.add_argument("--org")
    x.add_argument("--dry", action="store_true")
    x.set_defaults(fn=update_check_script, lock=False)
    x = sub.add_parser("watch", help="add, list, or remove a merge watch (watches in state.json)")
    x.add_argument("action", choices=["add", "list", "ack", "remove"])
    x.add_argument("--id")
    x.add_argument("--pr", action="append", metavar="owner/repo#N")
    x.add_argument("--notify", help="session name wait.py reports for the trigger")
    x.add_argument("--note", help="what to tell it")
    x.set_defaults(fn=watch)
    sh = sub.add_parser("show", help="print one key, or the top-level keys")
    sh.add_argument("key", nargs="?")
    sh.set_defaults(fn=show)
    args = p.parse_args()
    with locked() if getattr(args, "lock", True) else contextlib.nullcontext():
        args.fn(args)


if __name__ == "__main__":
    main()
