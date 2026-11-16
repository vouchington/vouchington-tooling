#!/usr/bin/env -S python3 -I
"""Typed, atomic updates to the triage loop's state.json.

The state directory comes from the loop configuration (.triage-loop.json in the launch directory,
or the path in TRIAGE_LOOP_CONFIG). Every write checks the shape of the fields it touches, then
replaces state.json atomically. Add a subcommand rather than editing state.json another way.
"""
import argparse, datetime, json, os, sys, tempfile

SEEN_MAX = 200


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


def expect(value, kind, name):
    if not isinstance(value, kind):
        sys.exit(f"state.json: {name} must be {kind.__name__}, got {type(value).__name__}")
    return value


def advance_hh(_):
    s = load()
    with open(HH_LAST) as f:
        d = json.load(f)
    hh = expect(s.setdefault("hookHarness", {}), dict, "hookHarness")
    seen = expect(hh.setdefault("seen", []), list, "hookHarness.seen")
    ids = [e["id"] for e in d.get("events", [])]
    for i in ids:
        if i not in seen:
            seen.append(i)
    hh["seen"] = seen[-SEEN_MAX:]
    if d.get("cursor"):
        hh["cursor"] = d["cursor"]
    save(s)
    print(json.dumps({"events": len(ids), "cursorAdvanced": bool(d.get("cursor"))}))


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
    sh = sub.add_parser("show", help="print one key, or the top-level keys")
    sh.add_argument("key", nargs="?")
    sh.set_defaults(fn=show)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
