import {
  extractShellCommandArguments,
  extractShellCommandSubstitutions,
  stripNonShellHeredocBodies,
} from '../shell-parse/index.mts'

/**
 * The command text and every script nested in it that the GitHub policies read. A heredoc body is
 * data unless a shell may read it as its script, but an unquoted-delimiter body still runs its
 * command substitutions, so each candidate is read with its bodies blanked.
 */
export function commandsToInspectForGitHubPolicy(command: string): string[] {
  const commands = [command.replace(/\\\n/g, ' ')]
  const inspected = new Set<string>()

  for (const command of commands) {
    const {
      bodySubstitutions,
      shellBodies,
      textWithoutBodies: candidate,
    } = stripNonShellHeredocBodies(command)
    if (inspected.has(candidate)) {
      continue
    }
    inspected.add(candidate)
    commands.push(
      ...extractShellCommandArguments(candidate).map(({ command: shellCommand }) => shellCommand),
      ...extractShellCommandSubstitutions(candidate),
      ...shellBodies,
      ...bodySubstitutions,
    )
  }

  return [...inspected]
}
