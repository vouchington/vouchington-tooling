#!/usr/bin/env -S python3 -I
"""Cancel workflow runs stuck in queued/in_progress/waiting/pending longer than a threshold.

By default it POSTs `cancel` for each run older than the threshold, and `force-cancel` only when
cancel answers 409 and the run is still stuck. With --dry-run it only lists. One output line per
run. Runs younger than the threshold are never listed or touched.
"""
import argparse, datetime, os, re, sys, urllib.parse

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ghlib import Exhausted, Gh, GhError, fail, parse_time, queue_pr

STATUSES = ("queued", "in_progress", "waiting", "pending", "requested")
MIN_SECONDS = 3600
UNITS = {"m": 60, "h": 3600, "d": 86400}


def duration(text):
    found = re.fullmatch(r"(\d+)([mhd])", text)
    if not found:
        fail(f"--older-than {text!r}: use a number and m, h, or d (for example 6h)")
    value = int(found.group(1)) * UNITS[found.group(2)]
    if value < MIN_SECONDS:
        fail("--older-than must be at least 1h")
    return value


def age_of(run, now):
    start = parse_time(run.get("created_at"))
    if run.get("status") == "in_progress":
        start = parse_time(run.get("run_started_at")) or start
    return None if start is None else (now - start).total_seconds()


def where(run):
    pr = queue_pr(run.get("head_branch"))
    if pr:
        return f"PR#{pr}(queue)"
    prs = run.get("pull_requests") or []
    return f"PR#{prs[0]['number']}" if prs else run.get("head_branch") or "-"


def human(value):
    return f"{value / 3600:.1f}h" if value < 172800 else f"{value / 86400:.1f}d"


def stuck(gh, repo, statuses, threshold, now, limit):
    cutoff = (now - datetime.timedelta(seconds=threshold)).strftime("%Y-%m-%dT%H:%M:%SZ")
    found, notes = {}, []
    for status in statuses:
        params = {"status": status}
        if status != "in_progress":
            params["created"] = f"<{cutoff}"
        runs, total, note = gh.pages(
            f"repos/{repo}/actions/runs?{urllib.parse.urlencode(params)}", "workflow_runs", limit)
        if note:
            notes.append(f"{status}: {note} (listed {len(runs)} of {total})")
        for run in runs:
            age = age_of(run, now)
            if age is not None and age > threshold:
                found[run["id"]] = (run, age)
    return sorted(found.values(), key=lambda item: -item[1]), notes


def cancel(gh, repo, run, statuses, threshold, now):
    base = f"repos/{repo}/actions/runs/{run['id']}"
    try:
        gh.api(f"{base}/cancel", "POST")
        return "cancelled"
    except GhError as error:
        if error.status != 409:
            return f"failed HTTP {error.status or '?'}"
    try:
        current = gh.api(base)
        age = age_of(current, now)
        if current.get("status") not in statuses or age is None or age <= threshold:
            return f"left alone: now {current.get('status')}"
        gh.api(f"{base}/force-cancel", "POST")
        return "force-cancelled"
    except GhError as error:
        return f"force-cancel failed HTTP {error.status or '?'}"


def main(argv=None, now=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--repo", required=True)
    parser.add_argument("--older-than", default="6h")
    parser.add_argument("--status", default="queued,in_progress,waiting,pending")
    parser.add_argument("--dry-run", action="store_true", help="only list; cancel nothing")
    parser.add_argument("--limit", type=int, default=300, help="most runs listed per status")
    parser.add_argument("--max-calls", type=int, default=200)
    args = parser.parse_args(argv)
    threshold = duration(args.older_than)
    statuses = [s for s in args.status.split(",") if s]
    if not statuses or any(s not in STATUSES for s in statuses):
        fail(f"--status takes {','.join(STATUSES)}")
    now = now or datetime.datetime.now(datetime.timezone.utc)
    gh = Gh(args.max_calls)
    try:
        runs, notes = stuck(gh, args.repo, statuses, threshold, now, args.limit)
        print(f"stale {args.repo} older-than={args.older_than} status={','.join(statuses)} "
              f"n={len(runs)} mode={'dry-run' if args.dry_run else 'cancel'}")
        for run, age in runs:
            line = f"{run['id']} {run.get('name')} {run.get('event')} {where(run)} {run.get('status')} {human(age)}"
            if not args.dry_run:
                try:
                    line += f" -> {cancel(gh, args.repo, run, statuses, threshold, now)}"
                except Exhausted as error:
                    line += f" -> skipped: {error}"
            print(line)
    except (Exhausted, GhError) as error:
        fail(f"{args.repo}: {error}")
    for note in notes:
        print(f"truncated {note}")


if __name__ == "__main__":
    main()
