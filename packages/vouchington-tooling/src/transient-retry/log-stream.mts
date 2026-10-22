import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

import { ghEnvWithToken } from './gh-api.mts'

type GhChild = ChildProcessByStdio<null, Readable, Readable>
export type SpawnGh = (args: string[]) => GhChild

const STDERR_MAX_BYTES = 4 * 1024

const spawnGhWith =
  (buildEnv: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv): SpawnGh =>
  (args) =>
    spawn('gh', args, { env: buildEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'] })

/** A log streamer whose `gh` child sees `tokenEnv`'s value as `GH_TOKEN`, like `createGhRunner`. */
export const createGhLogStreamer = (tokenEnv?: string) => (path: string) =>
  streamGhApiLog(path, spawnGhWith(ghEnvWithToken(tokenEnv)))

/**
 * Streams one `gh api` response body in chunks so the caller never buffers a whole job log. If the
 * consumer stops early the child is killed. A non-zero exit throws with at most 4 KiB of stderr.
 */
export async function* streamGhApiLog(
  path: string,
  spawnChild: SpawnGh = spawnGhWith(ghEnvWithToken()),
): AsyncGenerator<Buffer> {
  const child = spawnChild(['api', '--allow-escape-sequences', path])
  const stderr: Buffer[] = []
  let stderrBytes = 0
  child.stderr.on('data', (chunk: Buffer) => {
    const part = Buffer.from(chunk).subarray(0, STDERR_MAX_BYTES - stderrBytes)
    stderr.push(part)
    stderrBytes += part.byteLength
  })
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  closed.catch(() => undefined)
  let finished = false
  try {
    for await (const chunk of child.stdout) yield Buffer.from(chunk)
    finished = true
  } finally {
    if (!finished) child.kill()
  }
  const code = await closed
  if (code !== 0) {
    throw new Error(
      `gh api ${path} exited with status ${String(code)}: ${Buffer.concat(stderr).toString('utf8')}`,
    )
  }
}
