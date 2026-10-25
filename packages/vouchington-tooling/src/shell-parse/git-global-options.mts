const GIT_GLOBAL_OPTIONS_RE = new RegExp(
  String.raw`\bgit(?:\s+(?:` +
    String.raw`-C\s+(?:"[^"]*"|'[^']*'|\S+)|` +
    String.raw`-c\s+(?!["']?[Cc][Oo][Rr][Ee]\.[Hh][Oo][Oo][Kk][Ss][Pp][Aa][Tt][Hh]\b)(?:"[^"]*"|'[^']*'|[^\s=]+(?:=(?:"[^"]*"|'[^']*'|\S+))?)|` +
    String.raw`--(?:git-dir|work-tree|namespace|exec-path)=[^\s]+|` +
    String.raw`--(?:no-pager|paginate|bare|no-replace-objects|version|help|html-path|man-path|info-path)|` +
    String.raw`-[vhpP]` +
    String.raw`))+`,
  'g',
)

/** Collapse `git -C <path>` / other globals so banned-subcommand regexes still match. */
export function stripGitGlobalOptionsForPolicy(command: string): string {
  return command.replace(GIT_GLOBAL_OPTIONS_RE, 'git')
}
