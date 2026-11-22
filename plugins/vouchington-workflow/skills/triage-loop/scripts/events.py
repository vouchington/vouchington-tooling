"""Event classification for wait.py: compact lines, quiet merges, dependency-bot merges, and watches."""
import json, re, state, late_review

FIELDS = ("id", "repo", "event", "action", "prs", "issue", "reason", "conclusion", "workflow",
          "runId", "command", "commentId", "headSha")
QUIET_KEEP = 100
TRACKING = ("shepherds", "routed", "delegations", "escalations", "intake")


def compact(event):
    """One stable line: the fields the loop uses, in a fixed order, without empty values."""
    line = {k: event[k] for k in FIELDS if event.get(k) not in (None, "", [])}
    if event.get("sender"):
        line["sender"] = (event.get("sender") or {}).get("login")
    pull = (event.get("payload") or {}).get("pull_request")
    if event.get("event") == "pull_request" and isinstance(pull, dict):
        line["merged"] = pull.get("merged") is True
    return line


def pull_of(event):
    pull = (event.get("payload") or {}).get("pull_request")
    return pull if isinstance(pull, dict) else {}


def is_merge(event):
    return event.get("event") == "pull_request" and event.get("action") == "closed" and pull_of(event).get("merged") is True


def ref_of(event, org):
    number = pull_of(event).get("number") or next(iter(event.get("prs") or []), None)
    repo = event.get("repo") or ""
    return f"{repo if '/' in repo else org + '/' + repo}#{number}"


def login(name):
    return (name or "").removeprefix("app/").removesuffix("[bot]").lower()


def is_dependency_bot(event, cfg):
    author = ((cfg.get("dependencyBot") or {}).get("author")) or "dependabot"
    return login((pull_of(event).get("user") or {}).get("login")) == login(author)


def triage_merge(event, cfg):
    """Return (line, ref, bot) for one merge event; line is None when it is clean."""
    ref = ref_of(event, cfg["org"])
    line = compact(event)
    try:
        result = late_review.check(ref)
    except Exception as error:  # any failure returns the merge rather than killing the wait
        return {**line, "lateReviewError": str(error)[:200]}, ref, is_dependency_bot(event, cfg)
    if result["unresolved"] or result["late"] or result["truncated"]:
        found = {"unresolved": result["unresolved"], "late": result["late"]}
        return {**line, **found, **({"truncated": True} if result["truncated"] else {})}, ref, is_dependency_bot(event, cfg)
    return None, ref, is_dependency_bot(event, cfg)


def tracked(s, ref):
    """True when a loop record (shepherd, routing, delegation, escalation, intake) mentions the PR."""
    pattern = re.compile(re.escape(ref.split("/", 1)[1]) + r"(?!\d)", re.I)
    return any(pattern.search(json.dumps(s.get(key) or "")) for key in TRACKING)


def update_watches(s, merged):
    """Record merged PRs in each watch; return a trigger for every complete watch not yet acked.
    A trigger repeats on each wait until `state.py watch ack|remove`, so a crash cannot lose it."""
    triggers = []
    for w in s.get("watches") or []:
        wanted = {p.lower() for p in w["prs"]}
        w["merged"] = sorted({r.lower() for r in w.get("merged", [])} | {r.lower() for r in merged} & wanted)
        if set(w["merged"]) >= wanted and not w.get("ackedAt"):
            triggers.append({"event": "watch", "id": w["id"], "notify": w["notify"], "note": w.get("note", ""), "prs": w["prs"]})
    return triggers


def sweep(events, cfg):
    """Split a wait result's events into (actionable lines, raw actionable events, watch triggers).
    Clean merges are recorded in `quietMerges` (and `pendingUpdateChecks` for dependency-bot PRs), their
    ids marked seen, and watches updated, all in one locked write."""
    s = state.load()
    seen = set(((s.get("hookHarness") or {}).get("seen")) or [])
    lines, raw, quiet, bots, merged, quiet_ids = [], [], [], [], [], []
    for event in events:
        if not is_merge(event):
            lines.append(compact(event)), raw.append(event)
            continue
        if event.get("id") in seen:
            continue
        line, ref, bot = triage_merge(event, cfg)
        if line is None and tracked(s, ref):
            line = {**compact(event), "tracked": True}
        merged.append(ref)
        if bot:
            bots.append(ref.split("#")[0].split("/")[1])
        if line:
            lines.append(line), raw.append(event)
        else:
            quiet.append(ref), quiet_ids.append(event.get("id"))
    with state.locked():
        s = state.load()
        at = state.now()
        log = s.setdefault("quietMerges", [])
        log.extend(r.split("/", 1)[1] for r in quiet)
        s["quietMerges"] = log[-QUIET_KEEP:]
        pending = s.setdefault("pendingUpdateChecks", [])
        pending.extend({"repo": r, "at": at} for r in dict.fromkeys(bots) if r not in {p["repo"] for p in pending})
        triggers = update_watches(s, merged)
        state.record_events(s, [i for i in quiet_ids if i], None)
        state.save(s)
    return lines, raw, triggers


def watch_triggers():
    """Triggers for watches already complete and unacked, without new events."""
    with state.locked():
        s = state.load()
        triggers = update_watches(s, [])
        state.save(s)
    return triggers
