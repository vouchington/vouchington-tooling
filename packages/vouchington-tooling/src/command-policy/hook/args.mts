import { HOOK_HARNESSES, type HookHarness } from './types.mts'

const HOOK_USAGE =
  'usage: vouchington hook pre-tool-use|post-tool-use --harness claude|codex|cursor|grok --policy <module> [--root <dir>]'

export type HookArgs = {
  event: 'pre-tool-use' | 'post-tool-use'
  harness: HookHarness
  policy: string
  root?: string
}

type Flags = { harness?: string; policy?: string; root?: string }

/** Parses `hook` arguments; throws a usage error naming the first problem. */
export function parseHookArgs(args: readonly string[]): HookArgs {
  const [event, ...rest] = args
  if (event !== 'pre-tool-use' && event !== 'post-tool-use') {
    throw new Error(`${HOOK_USAGE}\nunknown or missing hook event: ${event ?? '(none)'}`)
  }
  const flags = parseFlags(rest)
  const harness = flags.harness
  if (!HOOK_HARNESSES.includes(harness as HookHarness)) {
    throw new Error(`${HOOK_USAGE}\n--harness must be one of ${HOOK_HARNESSES.join(', ')}`)
  }
  if (flags.policy === undefined || flags.policy === '') {
    throw new Error(`${HOOK_USAGE}\n--policy <module> is required`)
  }
  return {
    event,
    harness: harness as HookHarness,
    policy: flags.policy,
    ...(flags.root === undefined ? {} : { root: flags.root }),
  }
}

function parseFlags(args: readonly string[]): Flags {
  const flags: Flags = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    const [name, inline] = arg.startsWith('--') ? splitFlag(arg) : [arg, undefined]
    if (name !== '--harness' && name !== '--policy' && name !== '--root') {
      throw new Error(`${HOOK_USAGE}\nunknown argument: ${arg}`)
    }
    const value = inline ?? args[(index += 1)]
    if (value === undefined) {
      throw new Error(`${HOOK_USAGE}\n${name} needs a value`)
    }
    flags[name.slice(2) as keyof Flags] = value
  }
  return flags
}

function splitFlag(arg: string): [string, string | undefined] {
  const equals = arg.indexOf('=')
  return equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)]
}
