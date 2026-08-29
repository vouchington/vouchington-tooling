export const PR_JSON_FIELDS =
  'number,state,mergedAt,mergeCommit,changedFiles,files,commits,headRefName,baseRefName'

export type CommandResult = {
  ok: boolean
  stdout: string
  stderr: string
  exitCode?: number | null
}
export type CommandExecutor = (command: string, args: string[]) => Promise<CommandResult>

export type RetrospectiveFactsOptions = {
  pr?: string
  branch?: string
  noPr?: boolean
  repo?: string
  raw?: boolean
  execute?: CommandExecutor
  onWarning?: (message: string) => void
}
