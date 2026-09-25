---
'vouchington-tooling': patch
---

`vouchington pnpm-install` now passes `--no-prod` instead of `--prod=false`, so its installs run on
pnpm 12, whose native CLI rejects `--prod=false`. The flag behaves the same on pnpm 11.
