# Dependency-bot update check

GitHub exposes no REST endpoint for Dependabot's "Check for updates" button, so the sweep uses the
host browser with as few actions as possible and no clicks. Keep the bot's open-PR limit at the
configured `dependencyBot.openPullRequestLimit`; never propose raising it.

## Targets

Request a check for every repository and ecosystem whose dependency-bot PRs merged this tick or
sweep (merges free slots), and for every repository with none open. Batch all of them into one
browser call.

## Steps

1. Read the host's open tabs, then open one tab on `https://github.com/<org>` (signed in, same
   origin, so the page's session and each form's own CSRF token are used).
2. Copy the script below, set `ORG` to the configured `org` and `TARGETS` to the target
   repositories (repository name to `null` for every ecosystem, or a list of ecosystem names such
   as `['npm']`), and pass it as the text of ONE call to the host's in-page JavaScript tool.
3. It fetches each repository's update configs, skips those already running or queued, POSTs each
   remaining "Check for updates" form, and returns one line per config ending in the newest job
   status. Expect `Running now`.
4. Close the tab and record `update check requested` per repository in the summary.

A `NO FORM` line, or a POST that does not reach `Running now`, falls back to clicking that config's
`network/updates/<id>/jobs` button. If that fails too, or no browser or JavaScript tool is
available, list the repository in the summary.

## Script

Set `DRY = true` to report what it would trigger without posting.

```js
const ORG = 'example-org'
const TARGETS = { 'example-repo': null }
const DRY = false

const P = new DOMParser()
const page = async (u) => P.parseFromString(await (await fetch(u)).text(), 'text/html')
const out = []
for (const [repo, ecos] of Object.entries(TARGETS)) {
  const list = await (await fetch(`/${ORG}/${repo}/network/updates`)).text()
  const ids = [...new Set([...list.matchAll(/network\/updates\/(\d+)\/jobs/g)].map((m) => m[1]))]
  if (!ids.length) {
    out.push(`${repo}: no update configs (signed out or no access?)`)
    continue
  }
  for (const id of ids) {
    const url = `/${ORG}/${repo}/network/updates/${id}/jobs`
    const doc = await page(url)
    const main = doc.querySelector('main')?.innerText ?? ''
    const eco = (main.match(/Export SBOM\s+(\S+)/) || [])[1] ?? '?'
    const file = (main.match(/Export SBOM\s+\S+\s+(\S+)/) || [])[1] ?? ''
    if (ecos && !ecos.includes(eco)) continue
    const label = `${repo} ${eco} ${file} [${id}]`
    const recent = (main.split('Recent jobs')[1] ?? '').replace(/\s+/g, ' ').trim()
    if (/^\S+ update \d+ (Running now|Queued)/.test(recent)) {
      out.push(`${label}: already running`)
      continue
    }
    const form = [...doc.querySelectorAll('form')].find((f) =>
      /Check for updates/.test(f.textContent),
    )
    if (!form) {
      out.push(`${label}: NO FORM (no permission or UI changed)`)
      continue
    }
    if (DRY) {
      out.push(`${label}: would trigger`)
      continue
    }
    const res = await fetch(form.getAttribute('action'), {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'text/html' },
    })
    const after = ((await page(url)).querySelector('main')?.innerText.split('Recent jobs')[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    out.push(`${label}: POST ${res.status} -> ${after.slice(0, 60)}`)
  }
}
out.join('\n')
```
