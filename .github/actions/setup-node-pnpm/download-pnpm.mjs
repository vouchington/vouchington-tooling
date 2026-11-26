// Downloads the resolved pnpm release's native binary from the npm registry under the shared
// deadline and puts it on GITHUB_PATH. Node >= 24, no dependencies.
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { getBuffer, retryDownload } from './bounded-download.mjs'
import { registryUrl } from './deadline.mjs'

export function platformPackage(platform, arch, musl) {
  return `@pnpm/exe.${platform}-${arch}${platform === 'linux' && musl ? '-musl' : ''}`
}

export function isMusl(report = process.report?.getReport?.()) {
  return !report?.header?.glibcVersionRuntime
}

// Returns the bytes of the first regular file named `wanted` in a tar archive.
export function extractFile(tar, wanted) {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.toString('utf8', offset, offset + 100).replace(/\0.*$/su, '')
    if (name === '') break
    const size = Number.parseInt(tar.toString('utf8', offset + 124, offset + 136), 8)
    const data = offset + 512
    if (name === wanted) return tar.subarray(data, data + size)
    offset = data + Math.ceil(size / 512) * 512
  }
  throw new Error(`${wanted} not found in the pnpm package`)
}

export function verifyIntegrity(bytes, integrity) {
  const [algorithm, expected] = String(integrity).split('-')
  if (algorithm !== 'sha512') throw new Error(`unsupported integrity "${integrity}"`)
  if (createHash('sha512').update(bytes).digest('base64') !== expected) {
    throw new Error('downloaded pnpm package failed its integrity check')
  }
}

export async function downloadPnpm(
  env,
  signal,
  fetchImpl,
  platform = process.platform,
  touch = () => {},
) {
  const version = (env.PNPM_VERSION ?? '').trim()
  if (version === '') throw new Error('PNPM_VERSION is not set')
  const base = registryUrl(env).replace(/\/?$/u, '/')
  const name = platformPackage(platform, process.arch, platform === 'linux' && isMusl())
  const url = `${base}${name.replace('/', '%2f')}/${version}`
  const meta = JSON.parse((await getBuffer(url, signal, fetchImpl, touch)).toString('utf8'))
  const archive = await getBuffer(meta.dist.tarball, signal, fetchImpl, touch)
  verifyIntegrity(archive, meta.dist.integrity)
  const binary = platform === 'win32' ? 'pnpm.exe' : 'pnpm'
  const dir = join(env.RUNNER_TEMP || tmpdir(), `pnpm-${version}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, binary), extractFile(gunzipSync(archive), `package/${binary}`))
  chmodSync(join(dir, binary), 0o755)
  return dir
}

export async function main(
  env = process.env,
  now = Date.now(),
  fetchImpl = fetch,
  sleep,
  backoffMs,
) {
  return retryDownload(
    'pnpm download',
    async (signal, touch) => {
      const dir = await downloadPnpm(env, signal, fetchImpl, undefined, touch)
      if (env.GITHUB_PATH) appendFileSync(env.GITHUB_PATH, `${dir}\n`)
      console.log(`Installed pnpm ${env.PNPM_VERSION} to ${dir}`)
    },
    env,
    now,
    sleep,
    backoffMs,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main()
