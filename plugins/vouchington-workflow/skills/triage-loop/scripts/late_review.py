"""Late-review check for merged pull requests, shared by state.py and wait.py.

For one `owner/repo#N` it reports the PR state, mergedAt, the unresolved review threads, and the
non-empty reviews submitted after mergedAt. Threads and reviews are paged 100 at a time, up to
MAX_PAGES pages each; a PR with more is reported with `truncated: true` rather than undercounted.
"""
import json, re, subprocess

MAX_PAGES = 5
REF = re.compile(r"^([\w.-]+)/([\w.-]+)#(\d+)$")
QUERY = (
    "query($o:String!,$n:String!,$p:Int!,$c:String){repository(owner:$o,name:$n){pullRequest(number:$p){"
    "state mergedAt %s(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{%s}}}}}"
)
CONNECTIONS = {"reviewThreads": "isResolved", "reviews": "body submittedAt"}


class LateReviewError(Exception):
    pass


def graphql(owner, name, number, connection, cursor):
    command = ["gh", "api", "graphql", "-f", f"query={QUERY % (connection, CONNECTIONS[connection])}",
               "-f", f"o={owner}", "-f", f"n={name}", "-F", f"p={number}"]
    if cursor:
        command += ["-f", f"c={cursor}"]
    done = subprocess.run(command, capture_output=True, text=True)
    if done.returncode != 0:
        raise LateReviewError(f"gh exited {done.returncode}: {done.stderr.strip()[:200]}")
    try:
        pull = json.loads(done.stdout)["data"]["repository"]["pullRequest"]
        return pull, pull[connection]
    except (ValueError, KeyError, TypeError):
        raise LateReviewError("pull request not found or unexpected response")


def fetch(owner, name, number, connection):
    """Return (pull, nodes, truncated) for one connection."""
    cursor, nodes = None, []
    for _ in range(MAX_PAGES):
        pull, conn = graphql(owner, name, number, connection, cursor)
        nodes += conn["nodes"]
        if not conn["pageInfo"]["hasNextPage"]:
            return pull, nodes, False
        cursor = conn["pageInfo"]["endCursor"]
    return pull, nodes, True


def check(ref):
    match = REF.match(ref)
    if not match:
        raise LateReviewError(f"{ref!r} must look like owner/repo#N")
    owner, name, number = match.groups()
    pull, threads, cut_threads = fetch(owner, name, number, "reviewThreads")
    _, reviews, cut_reviews = fetch(owner, name, number, "reviews")
    merged_at = pull["mergedAt"]
    late = [r for r in reviews if merged_at and (r["body"] or "").strip() and r["submittedAt"] and r["submittedAt"] > merged_at]
    return {"ref": ref, "state": pull["state"], "mergedAt": merged_at,
            "unresolved": sum(not t["isResolved"] for t in threads), "late": len(late),
            "truncated": cut_threads or cut_reviews}


def is_merged(ref):
    match = REF.match(ref)
    if not match:
        raise LateReviewError(f"{ref!r} must look like owner/repo#N")
    owner, name, number = match.groups()
    done = subprocess.run(["gh", "api", f"repos/{owner}/{name}/pulls/{number}", "--jq", ".merged_at // empty"],
                          capture_output=True, text=True)
    if done.returncode != 0:
        raise LateReviewError(f"gh exited {done.returncode}: {done.stderr.strip()[:200]}")
    return bool(done.stdout.strip())


def line(result):
    text = (f"{result['ref']} {result['state']} mergedAt={result['mergedAt']} "
            f"unresolved={result['unresolved']} late={result['late']}")
    return text + (" truncated" if result["truncated"] else "")
