"""Report extras: rate limits, draft split, and the enrichment calls made after job sampling."""
import collections

from ghlib import Exhausted, GhError


def limits(gh):
    data = gh.api("rate_limit")["resources"]
    return {k: {"remaining": data[k]["remaining"], "limit": data[k]["limit"]} for k in ("core", "graphql")}


def draft_split(runs, drafts):
    out = collections.Counter()
    for run in runs:
        if run.get("event") != "pull_request":
            continue
        prs = run.get("pull_requests") or []
        out["unknown" if not prs or prs[0]["number"] not in drafts else
            "draft" if drafts[prs[0]["number"]] else "ready"] += 1
    return dict(out)


def enrich(gh, repo, runs, out):
    """Required checks, draft split, and final rate limits; stops quietly when the call cap hits."""
    try:
        branch = gh.api(f"repos/{repo}")["default_branch"]
        try:
            rules = gh.api(f"repos/{repo}/rules/branches/{branch}")
            out["requiredChecks"] = sorted({c["context"] for r in rules if r.get("type") == "required_status_checks"
                                            for c in r["parameters"].get("required_status_checks", [])})
        except GhError as error:
            out["truncated"].append(f"rules: {error}")
        pulls, _, note = gh.pages(f"repos/{repo}/pulls?state=all&sort=updated&direction=desc", "", 300)
        if note:
            out["truncated"].append(f"pulls (draft state): {note}")
        out["draftRuns"] = draft_split(runs, {p["number"]: bool(p.get("draft")) for p in pulls})
        out["rateAfter"] = limits(gh)
    except Exhausted as error:
        out["truncated"].append(f"enrichment: {error}")
