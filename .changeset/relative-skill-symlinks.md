---
'vouchington-tooling': patch
---

Fix `linkSkill` to create symlinks with a target relative to the target directory instead of an absolute path, so linked skills keep working after the consuming repository is moved or checked out at a different path (e.g. `../../.agents/skills/<name>` instead of `/abs/path/.agents/skills/<name>`).
