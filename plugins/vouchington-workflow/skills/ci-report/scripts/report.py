#!/usr/bin/env -S python3 -I
"""Compact CI report for one repository: timings, queue waits, jobs, runner minutes, failures.

Reads workflow runs for the window (paginated at 100, capped by --max-runs and --max-calls), samples
per-run jobs, and prints one line per row. --json prints the full structure. Whatever the caps cut
is listed under `truncated`. Wall-clock is updated_at minus run_started_at of the latest attempt.
"""
import argparse, collections, datetime, json, math, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extras import enrich, limits
from ghlib import Exhausted, Gh, GhError, fail, fmt_seconds as fs, percentile, queue_pr, seconds

JOBS_PER_RUN = 1000


def multiplier(label):
    low = (label or "").lower()
    return 10 if "mac" in low else 2 if "win" in low else 1


def run_stats(runs):
    """Per (workflow, event): count, wall-clock and queue-wait percentiles, conclusions."""
    groups = collections.defaultdict(list)
    for run in runs:
        groups[(run.get("name") or "?", run.get("event") or "?")].append(run)
    rows = []
    for (name, event), items in sorted(groups.items()):
        wall = [v for r in items if r.get("status") == "completed"
                if (v := seconds(r.get("run_started_at"), r.get("updated_at"))) is not None]
        queue = [v for r in items if (v := seconds(r.get("created_at"), r.get("run_started_at"))) is not None]
        counts = collections.Counter(r.get("conclusion") or r.get("status") or "?" for r in items)
        rows.append({
            "workflow": name, "event": event, "n": len(items),
            "wall": {"p50": percentile(wall, .5), "p90": percentile(wall, .9), "max": max(wall, default=None)},
            "queue": {"p50": percentile(queue, .5), "p90": percentile(queue, .9)},
            "conclusions": dict(counts), "cancelledShare": round(counts["cancelled"] / len(items), 3),
        })
    return rows


def job_stats(sampled):
    """sampled: [(run, jobs)]. Per-job rows, runner minutes by label, failure signatures."""
    jobs, minutes, sigs = {}, collections.Counter(), {}
    for run, items in sampled:
        for job in items:
            label = (job.get("labels") or ["?"])[0]
            key = (run.get("name") or "?", job.get("name") or "?", label)
            row = jobs.setdefault(key, {"durations": [], "fails": 0, "skipped": 0})
            span = seconds(job.get("started_at"), job.get("completed_at"))
            if span is None or job.get("conclusion") == "skipped":
                row["skipped"] += 1
                continue
            row["durations"].append(span)
            minutes[label] += math.ceil(span / 60)
            if job.get("conclusion") == "failure":
                row["fails"] += 1
                step = next((s.get("name") for s in job.get("steps") or [] if s.get("conclusion") == "failure"), "-")
                sig = sigs.setdefault((job.get("name"), step), {"count": 0, "runs": []})
                sig["count"] += 1
                if run["id"] not in sig["runs"] and len(sig["runs"]) < 3:
                    sig["runs"].append(run["id"])
    rows = [{"workflow": w, "job": j, "runner": label, "n": len(v["durations"]), "skipped": v["skipped"],
             "median": percentile(v["durations"], .5), "max": max(v["durations"], default=None),
             "totalMin": round(sum(v["durations"]) / 60, 1), "failures": v["fails"]}
            for (w, j, label), v in sorted(jobs.items(), key=lambda kv: -sum(kv[1]["durations"]))]
    runner = [{"label": label, "minutes": m, "multiplier": multiplier(label), "billed": m * multiplier(label)}
              for label, m in sorted(minutes.items(), key=lambda kv: -kv[1])]
    signatures = [{"job": j, "step": s, **v} for (j, s), v in sorted(sigs.items(), key=lambda kv: -kv[1]["count"])]
    return rows, runner, signatures


def ejections(runs):
    """Failing merge_group runs mapped to their PR through the queue head ref."""
    found = collections.defaultdict(list)
    for run in runs:
        if run.get("event") == "merge_group" and run.get("conclusion") == "failure":
            found[queue_pr(run.get("head_branch"))].append(run["id"])
    return [{"pr": pr, "runs": ids[:3], "count": len(ids)} for pr, ids in sorted(found.items(), key=lambda kv: -len(kv[1]))]


def reruns(runs):
    out = collections.Counter(f"{r.get('name')}" for r in runs
                              if (r.get("run_attempt") or 1) > 1 and r.get("conclusion") == "success")
    return dict(out)


def sample(runs, size):
    """Failed runs first (up to half the sample), then the most recent others."""
    ordered = sorted(runs, key=lambda r: r.get("created_at") or "", reverse=True)
    failed = [r for r in ordered if r.get("conclusion") == "failure"][: size // 2]
    rest = [r for r in ordered if r not in failed and r.get("status") == "completed"]
    return failed + rest[: size - len(failed)]


def collect(gh, args, since):
    repo, truncated = args.repo, []
    events = [e for e in args.events.split(",") if e]
    quota, runs = max(1, args.max_runs // len(events)), []
    for event in events:
        got, total, note = gh.pages(f"repos/{repo}/actions/runs?event={event}&created=%3E%3D{since}", "workflow_runs", quota)
        runs += got
        if note:
            truncated.append(f"runs {event}: {note} (fetched {len(got)} of {total})")
    return runs, truncated


def main(argv=None, now=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--repo", required=True)
    parser.add_argument("--days", type=float, default=7)
    parser.add_argument("--events", default="merge_group,pull_request,push")
    parser.add_argument("--max-runs", type=int, default=300)
    parser.add_argument("--jobs-sample", type=int, default=40)
    parser.add_argument("--max-calls", type=int, default=120)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not args.events.strip(","):
        fail("--events is empty")
    now = now or datetime.datetime.now(datetime.timezone.utc)
    since = (now - datetime.timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    gh, out = Gh(args.max_calls), {"repo": args.repo, "since": since}
    try:
        out["rateBefore"] = limits(gh)
        runs, out["truncated"] = collect(gh, args, since)
        out["runs"] = len(runs)
        sampled = []
        for run in sample(runs, args.jobs_sample):
            jobs, _, note = gh.pages(f"repos/{args.repo}/actions/runs/{run['id']}/jobs?filter=latest", "jobs", JOBS_PER_RUN)
            if note:
                out["truncated"].append(f"jobs run {run['id']}: {note}")
            if jobs or not note:
                sampled.append((run, jobs))
            if "api-call cap" in note:
                break
        out["workflows"] = run_stats(runs)
        out["jobs"], out["runnerMinutes"], out["signatures"] = job_stats(sampled)
        out["jobsSample"] = len(sampled)
        out["ejections"], out["rerunSuccess"] = ejections(runs), reruns(runs)
        out.update(requiredChecks=None, draftRuns={}, rateAfter=None)
        enrich(gh, args.repo, runs, out)
    except (Exhausted, GhError) as error:
        fail(f"{args.repo}: {error}")
    out["apiCalls"] = gh.calls
    print(json.dumps(out) if args.json else render(out))


def render(o):
    lines = [f"report {o['repo']} since={o['since']} runs={o['runs']} jobsSample={o['jobsSample']} apiCalls={o['apiCalls']}"]
    for w in o["workflows"]:
        c = " ".join(f"{k}={v}" for k, v in sorted(w["conclusions"].items()))
        lines.append(f"wf {w['workflow']} {w['event']} n={w['n']} wall p50={fs(w['wall']['p50'])} p90={fs(w['wall']['p90'])} "
                     f"max={fs(w['wall']['max'])} queue p50={fs(w['queue']['p50'])} p90={fs(w['queue']['p90'])} "
                     f"{c} cancel%={w['cancelledShare']:.0%}")
    skipped = sum(j["skipped"] for j in o["jobs"] if not j["n"])
    for j in (j for j in o["jobs"] if j["n"]):
        lines.append(f"job {j['workflow']}/{j['job']} runner={j['runner']} n={j['n']} skipped={j['skipped']} "
                     f"median={fs(j['median'])} max={fs(j['max'])} total={j['totalMin']}m fail={j['failures']}")
    lines.append(f"jobs-skipped-only {skipped} (hidden; see --json)")
    for r in o["runnerMinutes"]:
        lines.append(f"runner {r['label']} min={r['minutes']} x{r['multiplier']} billed={r['billed']}")
    for s in o["signatures"]:
        lines.append(f"fail {s['job']} > {s['step']} n={s['count']} runs={','.join(map(str, s['runs']))}")
    for e in o["ejections"]:
        lines.append(f"eject PR#{e['pr']} n={e['count']} runs={','.join(map(str, e['runs']))}")
    lines.append("rerun-success " + (" ".join(f"{k}={v}" for k, v in o["rerunSuccess"].items()) or "none"))
    lines.append("required " + (",".join(o["requiredChecks"]) if o["requiredChecks"] is not None else "unavailable"))
    lines.append("draft-vs-ready " + (" ".join(f"{k}={v}" for k, v in sorted(o["draftRuns"].items())) or "none"))
    for when in (w for w in ("rateBefore", "rateAfter") if o[w]):
        lines.append(f"rate {when[4:].lower()} " + " ".join(f"{k}={v['remaining']}/{v['limit']}" for k, v in o[when].items()))
    lines += [f"truncated {t}" for t in o["truncated"]]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
