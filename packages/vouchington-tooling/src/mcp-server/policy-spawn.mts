import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

export type PolicyRequest = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  input: string
  timeoutMs: number
  maxOutputBytes: number
}

export type PolicyOutcome = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** True when stdout or stderr exceeded `maxOutputBytes` and the child was killed. */
  overflowed: boolean
}

export type PolicySpawner = (request: PolicyRequest) => Promise<PolicyOutcome>

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The directory of the first `gh` on the server's PATH, so policy checks can call it. */
function ghDirectory(env: NodeJS.ProcessEnv): string[] {
  const found = (env.PATH ?? '')
    .split(delimiter)
    .filter((directory) => directory !== '')
    .find((directory) => isExecutable(join(directory, 'gh')))
  return found === undefined ? [] : [found]
}

/** The fixed system directories, node's own, and the directory holding `gh`, deduplicated. */
function policyPath(env: NodeJS.ProcessEnv): string {
  const directories = [
    '/usr/bin',
    '/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    dirname(process.execPath),
    ...ghDirectory(env),
  ]
  return [...new Set(directories)].join(delimiter)
}

/**
 * The child's whole environment. Blackboard credentials and NODE_OPTIONS are never passed; GitHub
 * tokens are passed only when the server has them, for the checks that call `gh`.
 */
export function policyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { PATH: policyPath(env) }
  for (const name of ['HOME', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    const value = env[name]
    if (value !== undefined) child[name] = value
  }
  return child
}

export const spawnPolicy: PolicySpawner = (request) =>
  new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group, so every grandchild the policy started can be killed with it.
      detached: process.platform !== 'win32',
    })
    const killGroup = () => {
      try {
        process.kill(-(child.pid as number), 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] }
    const sizes = { stdout: 0, stderr: 0 }
    let timedOut = false
    let overflowed = false
    const timer = setTimeout(() => {
      timedOut = true
      killGroup()
    }, request.timeoutMs)
    for (const name of ['stdout', 'stderr'] as const)
      child[name].on('data', (chunk: Buffer) => {
        sizes[name] += chunk.length
        if (sizes[name] > request.maxOutputBytes) {
          overflowed = true
          killGroup()
        } else chunks[name].push(chunk)
      })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      // Reap anything the policy left running in its group, even after a normal exit: a detached
      // descendant would otherwise keep the GitHub token it inherited.
      killGroup()
      const text = (name: 'stdout' | 'stderr') => Buffer.concat(chunks[name]).toString('utf8')
      resolve({ exitCode, stdout: text('stdout'), stderr: text('stderr'), timedOut, overflowed })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(request.input)
  })
