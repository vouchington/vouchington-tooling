export interface CiLocalCommand {
  command: string
  description: string
  env?: Record<string, string | undefined>
  source?: { workflow: string; contains: string | string[] }
}

export interface CiLocalTarget {
  description: string
  commands: CiLocalCommand[]
}

export interface ParsedCiLocalArgs {
  dryRun: boolean
  help: boolean
  list: boolean
  target?: string
}

export interface CiLocalSpawnResult {
  error?: Error | undefined
  status: number | null
}

export interface CiLocalSpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: 'inherit'
}

export type CiLocalSpawn = (
  command: string,
  args: readonly string[],
  options: CiLocalSpawnOptions,
) => CiLocalSpawnResult

export interface LineWriter {
  write(chunk: string): unknown
}

export interface RunCiLocalOptions {
  args: readonly string[]
  targets: Record<string, CiLocalTarget>
  cwd?: string
  spawn?: CiLocalSpawn
  stdout?: LineWriter
  stderr?: LineWriter
  usage?: string
}
