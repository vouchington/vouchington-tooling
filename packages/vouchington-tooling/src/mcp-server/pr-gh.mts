import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GhRunner = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<string>

const FALLBACKS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']
const MAX_BUFFER_BYTES = 16_000_000

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** `gh` on the server's PATH, else a common absolute location. */
export async function locateGh(
  env: NodeJS.ProcessEnv,
  fallbacks: readonly string[] = FALLBACKS,
): Promise<string> {
  const onPath = (env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, 'gh'))
  for (const candidate of [...onPath, ...fallbacks])
    if (await isExecutableFile(candidate)) return candidate
  throw new Error("gh CLI not found on PATH; install gh or add it to the server's PATH")
}

/** The environment gh runs in: the server's, without the blackboard credentials. */
export function ghEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { AGENT_BLACKBOARD_URL: _url, AGENT_BLACKBOARD_TOKEN: _token, ...rest } = env
  return rest
}

/** A runner that locates gh once, on first use, from the server's environment. */
export function createGhRunner(
  serverEnv: NodeJS.ProcessEnv,
  locate: (env: NodeJS.ProcessEnv) => Promise<string> = locateGh,
): GhRunner {
  let located: Promise<string> | undefined
  return async (args, options) => {
    located ??= locate(serverEnv)
    const { stdout } = await execFileAsync(await located, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: MAX_BUFFER_BYTES,
    })
    return stdout
  }
}
