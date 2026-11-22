"""Shared helpers for ci-report scripts: a call-capped `gh api` wrapper, pagination, time math."""
import datetime, json, math, re, subprocess, sys


class GhError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class Exhausted(Exception):
    """The API-call cap was reached."""


class Gh:
    def __init__(self, max_calls):
        self.max_calls = max_calls
        self.calls = 0

    def api(self, path, method="GET"):
        if self.calls >= self.max_calls:
            raise Exhausted(f"api-call cap {self.max_calls} reached")
        self.calls += 1
        args = ["gh", "api", path] if method == "GET" else ["gh", "api", "-X", method, path]
        done = subprocess.run(args, capture_output=True, text=True)
        if done.returncode != 0:
            found = re.search(r"HTTP (\d{3})", done.stderr + done.stdout)
            raise GhError(done.stderr.strip() or done.stdout.strip() or "gh failed",
                          int(found.group(1)) if found else None)
        return json.loads(done.stdout) if done.stdout.strip() else {}

    def pages(self, path, key, limit):
        """Items under `key` across 100-item pages, at most `limit`: (items, total_count, note)."""
        items, total, page = [], None, 1
        joiner = "&" if "?" in path else "?"
        while len(items) < limit:
            try:
                data = self.api(f"{path}{joiner}per_page=100&page={page}")
            except Exhausted as error:
                return items, total, str(error)
            batch = data if isinstance(data, list) else data.get(key) or []
            total = None if isinstance(data, list) else data.get("total_count", total)
            items.extend(batch)
            if len(batch) < 100:
                return items[:limit], total, f"limit {limit} reached" if len(items) > limit else ""
            page += 1
        more = total is None or total > limit
        return items[:limit], total, f"limit {limit} reached" if more else ""


def parse_time(value):
    if not value:
        return None
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


def seconds(start, end):
    """Seconds between two ISO timestamps, or None when either is null; never negative."""
    a, b = parse_time(start), parse_time(end)
    return None if a is None or b is None else max(0.0, (b - a).total_seconds())


def percentile(values, q):
    """Nearest-rank percentile (q in 0..1) of a list; None when empty."""
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q * len(ordered)) - 1)] if ordered else None


def fmt_seconds(value):
    if value is None:
        return "-"
    if value < 90:
        return f"{value:.0f}s"
    return f"{value / 60:.1f}m" if value < 5400 else f"{value / 3600:.1f}h"


QUEUE_REF = re.compile(r"^gh-readonly-queue/(?P<base>.+)/pr-(?P<pr>\d+)-")


def queue_pr(head_branch):
    """The PR number a merge-queue head ref belongs to, or None."""
    found = QUEUE_REF.match(head_branch or "")
    return int(found.group("pr")) if found else None


def fail(message):
    sys.exit(f"ci-report: {message}")
