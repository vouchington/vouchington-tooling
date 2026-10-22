import { runHook } from '../../command-policy/hook/run.mts'

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** `vouchington hook pre-tool-use|post-tool-use`: see `runHook`. */
export function runHookCommand(args: string[]): Promise<number> {
  return runHook(args, {
    readStdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
  })
}
