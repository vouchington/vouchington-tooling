import { spawn } from 'node:child_process'
import { dirname } from 'node:path'

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

/**
 * The child's whole environment. Blackboard credentials and NODE_OPTIONS are never passed; GitHub
 * tokens are passed only when the server has them, for the checks that call `gh`.
 */
export function policyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { PATH: `/usr/bin:/bin:${dirname(process.execPath)}` }
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
    })
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] }
    const sizes = { stdout: 0, stderr: 0 }
    let timedOut = false
    let overflowed = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, request.timeoutMs)
    for (const name of ['stdout', 'stderr'] as const)
      child[name].on('data', (chunk: Buffer) => {
        sizes[name] += chunk.length
        if (sizes[name] > request.maxOutputBytes) {
          overflowed = true
          child.kill('SIGKILL')
        } else chunks[name].push(chunk)
      })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const text = (name: 'stdout' | 'stderr') => Buffer.concat(chunks[name]).toString('utf8')
      resolve({ exitCode, stdout: text('stdout'), stderr: text('stderr'), timedOut, overflowed })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(request.input)
  })
