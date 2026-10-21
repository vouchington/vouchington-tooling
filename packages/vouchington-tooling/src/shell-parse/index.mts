export {
  decodeAnsiCStringEscape,
  decodeNumericAnsiEscape,
  readAnsiCString,
} from './ansi-c-string.mts'
export {
  readBacktickSubstitution,
  readParenthesizedSubstitution,
} from './shell-command-substitution-reads.mts'
export { extractShellCommandSubstitutions } from './shell-command-substitutions.mts'
export {
  parseCommandPrefix,
  readCommandPrefix,
  withoutRedirections,
} from './shell-command-wrappers.mts'
export type { CommandPrefix } from './shell-command-wrappers.mts'
export {
  commandsToInspectForGitPolicy,
  commandsToInspectPreservingQuotes,
  envPrefixSetsEditor,
  extractShellCommandArguments,
  isInteractiveRebaseContinue,
  shellCommandInheritsEditor,
  stripGitGlobalOptionsForPolicy,
  stripQuotedShellText,
} from './shell-commands.mts'
export type { ShellCommandArgument } from './shell-commands.mts'
export { readHeredocDelimiter } from './shell-heredoc-delimiter.mts'
export { heredocSpecsFromLine } from './shell-heredoc-parser.mts'
export type { HeredocSpec } from './shell-heredoc-parser.mts'
export { stripNonShellHeredocBodies } from './shell-heredoc.mts'
export {
  isRedirectionFd,
  isShellRedirectionOperatorToken,
  redirectionOperatorOf,
  SHELL_REDIRECTION_OPERATORS,
  shellRedirectionOperatorAt,
} from './shell-redirections.mts'
export {
  findShellScriptArguments,
  isShellWord,
  shellScriptOperandIndex,
} from './shell-script-operand.mts'
export type { ShellScriptArgument } from './shell-script-operand.mts'
export { shellReadsStdinAt } from './shell-stdin-script.mts'
export {
  commandSegmentStart,
  isShellAssignment,
  isShellCommandSeparator,
  nextShellCommandSeparatorIndex,
  plainShellAssignment,
} from './shell-token-utils.mts'
export { stripUnquotedShellComments } from './shell-tokenizer-comments.mts'
export { consumeShellSeparator } from './shell-tokenizer-operators.mts'
export { tokenizeShellWords, tokenizeShellWordsDetailed } from './shell-tokenizer.mts'
export type { ShellWord } from './shell-tokenizer.mts'
