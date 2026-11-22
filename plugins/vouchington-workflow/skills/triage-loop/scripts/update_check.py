"""Fills in triage-sweep's in-page "Check for updates" script for the host browser's JavaScript tool."""
import os, re

DOC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "triage-sweep", "references",
                   "dependency-update-check.md")
NAME = re.compile(r"^[\w.-]+$")


def targets(repos):
    """`name` checks every ecosystem; `name:npm,pip` limits the check to those ecosystems."""
    entries = []
    for repo in repos:
        name, _, ecos = repo.partition(":")
        listed = ecos.split(",") if ecos else []
        if not NAME.match(name) or not all(NAME.match(e) for e in listed):
            raise ValueError(f"{repo!r} must be name or name:ecosystem[,ecosystem]")
        entries.append(f"'{name}': " + ("[" + ", ".join(f"'{e}'" for e in listed) + "]" if listed else "null"))
    return "{ " + ", ".join(entries) + " }"


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
