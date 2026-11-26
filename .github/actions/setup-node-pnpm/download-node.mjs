// Puts the requested Node.js release in the runner toolcache, with the same idle-timeout and
// retry bounds as the pnpm download, so actions/setup-node finds it and never starts its own
// unbounded download from github.com/actions/node-versions. Does nothing when the toolcache
// already satisfies the version or when the version file is not a plain version number.
// Node >= 24, no dependencies.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getBuffer, retryDownload } from './bounded-download.mjs'

const DIST = 'https://nodejs.org/dist/'

// "24", "v24.1" or "24.1.2" (first line of the version file) as numbers, else undefined.
export function parseSpec(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(text.split('\n')[0].trim())
  return match
    ? match
        .slice(1)
        .filter((part) => part !== undefined)
        .map(Number)
    : undefined
}

// Stable releases only: a prerelease directory such as 24.0.0-rc.1 never satisfies a plain spec.
export const satisfies = (version, spec) =>
  !version.includes('-') &&
  version
    .split('.')
    .slice(0, spec.length)
    .every((part, i) => Number(part) === spec[i])

export function cachedVersion(toolcache, arch, spec) {
  const root = join(toolcache, 'node')
  if (!existsSync(root)) return undefined
  return readdirSync(root).find(
    (version) => satisfies(version, spec) && existsSync(join(root, version, `${arch}.complete`)),
  )
}

export function resolveVersion(index, spec) {
  const found = index.find((entry) => satisfies(entry.version.slice(1), spec))
  if (!found) throw new Error(`no Node.js release matches ${spec.join('.')}`)
  return found.version.slice(1)
}

export async function downloadNode(version, toolcache, arch, platform, signal, fetchImpl, touch) {
  const name = `node-v${version}-${platform}-${arch}.tar.gz`
  const base = `${DIST}v${version}/`
  const sums = (await getBuffer(`${base}SHASUMS256.txt`, signal, fetchImpl, touch)).toString()
  const expected = sums
    .split('\n')
    .find((line) => line.endsWith(`  ${name}`))
    ?.split(/\s+/u)[0]
  if (!expected) throw new Error(`${name} is not listed in SHASUMS256.txt`)
  const archive = await getBuffer(`${base}${name}`, signal, fetchImpl, touch)
  if (createHash('sha256').update(archive).digest('hex') !== expected) {
    throw new Error(`${name} failed its sha256 check`)
  }
  const tmp = mkdtempSync(join(tmpdir(), 'node-dl-'))
  const dir = join(toolcache, 'node', version, arch)
  try {
    writeFileSync(join(tmp, name), archive)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    execFileSync('tar', ['-xzf', join(tmp, name), '-C', dir, '--strip-components=1'])
    writeFileSync(`${dir}.complete`, '')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return dir
}

export async function main(
  env = process.env,
  now = Date.now(),
  fetchImpl = fetch,
  sleep,
  backoffMs,
  platform = process.platform,
  arch = process.arch,
) {
  const toolcache = env.RUNNER_TOOL_CACHE
  const file = join(env.GITHUB_WORKSPACE ?? '.', env.NODE_VERSION_FILE ?? '.nvmrc')
  const spec = existsSync(file) ? parseSpec(readFileSync(file, 'utf8')) : undefined
  if (!toolcache || !spec || !['linux', 'darwin'].includes(platform)) {
    console.log('Node.js version is left to actions/setup-node')
    return 0
  }
  const cached = cachedVersion(toolcache, arch, spec)
  if (cached) {
    console.log(`Node.js ${cached} is already in the toolcache`)
    return 0
  }
  return retryDownload(
    'node download',
    async (signal, touch) => {
      const version =
        spec.length === 3
          ? spec.join('.')
          : resolveVersion(
              JSON.parse(await getBuffer(`${DIST}index.json`, signal, fetchImpl, touch)),
              spec,
            )
      const dir = await downloadNode(version, toolcache, arch, platform, signal, fetchImpl, touch)
      console.log(`Installed Node.js ${version} to ${dir}`)
    },
    env,
    now,
    sleep,
    backoffMs,
    'nodejs.org',
  )
}

if (import.meta.main) process.exitCode = await main()
