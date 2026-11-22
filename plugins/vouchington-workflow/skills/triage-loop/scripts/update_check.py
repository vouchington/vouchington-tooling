"""Fills in triage-sweep's in-page "Check for updates" script for the host browser's JavaScript tool."""
import os, re

DOC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "triage-sweep", "references",
                   "dependency-update-check.md")
NAME = re.compile(r"^[\w.-]+$")


def targets(repos):
    """`name` checks every ecosystem; `name:npm,pip` limits the check to those ecosystems."""
    merged = {}  # repeated --repo options combine; an unrestricted one (None) covers every ecosystem
    for repo in repos:
        name, _, ecos = repo.partition(":")
        listed = ecos.split(",") if ecos else []
        if not NAME.match(name) or not all(NAME.match(e) for e in listed):
            raise ValueError(f"{repo!r} must be name or name:ecosystem[,ecosystem]")
        have = merged.get(name, [])
        merged[name] = None if not listed or (name in merged and have is None) else have + [e for e in listed if e not in have]
    return "{ " + ", ".join(
        f"'{n}': " + ("[" + ", ".join(f"'{e}'" for e in v) + "]" if v else "null") for n, v in merged.items()) + " }"


def script(org, repos, dry=False):
    if not NAME.match(org or ""):
        raise ValueError(f"org {org!r} is not a valid organization name")
    with open(DOC) as f:
        match = re.search(r"```js\n(.*?)```", f.read(), re.S)
    if not match:
        raise ValueError("dependency-update-check.md has no js block")
    code = match.group(1)
    for name, value in (("ORG", f"'{org}'"), ("TARGETS", targets(repos)), ("DRY", "true" if dry else "false")):
        code, count = re.subn(rf"^const {name} = .*$", lambda _: f"const {name} = {value}", code, count=1, flags=re.M)
        if count != 1:
            raise ValueError(f"dependency-update-check.md script has no `const {name} =` line")
    return code
