import { resolve } from 'node:path'

import { parseHookArgs } from './args.mts'
import {
  isAttendedClaudeSession,
  isAutomationContext,
  parseHookPayload,
  resolveHarness,
} from './harness.mts'
import { loadHookPolicy } from './policy-module.mts'
import { postToolUseOutput } from './post-tool-use.mts'
import { preToolUseOutput } from './pre-tool-use.mts'
import type { HookContext, HookPolicy } from './types.mts'

export type HookIo = {
  readStdin: () => Promise<string>
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
  env: NodeJS.ProcessEnv
  cwd: string
}

/**
 * `vouchington hook <event> --harness <h> --policy <module>`. Pre-tool-use fails closed (exit 2) when
 * its policy cannot load, because the gates it enforces are a security boundary; post-tool-use is
 * advisory and always exits 0. Bad arguments exit 2 before anything is read.
 */
export async function runHook(args: readonly string[], io: HookIo): Promise<number> {
  let parsed
  try {
    parsed = parseHookArgs(args)
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n`)
    // Post-tool-use is advisory: an argument typo must not reject an already-completed tool call.
    return args[0] === 'post-tool-use' ? 0 : 2
  }
  const blocking = parsed.event === 'pre-tool-use'
  try {
    const payload = parseHookPayload(await io.readStdin())
    const context: HookContext = {
      harness: resolveHarness(parsed.harness, io.env, payload),
      payload,
      env: io.env,
      root: resolve(io.cwd, parsed.root ?? '.'),
    }
    const policy = await loadHookPolicy(parsed.policy, context)
    await runOnPayload(policy, context, io)
    if (blocking) {
      const result = preToolUseOutput(payload, policy.command ?? {}, {
        harness: context.harness,
        attended: isAttendedClaudeSession(io.env),
        automationContext: isAutomationContext(io.env, parsed.automationEnv),
      })
      if (result.stdout !== '') io.stdout.write(result.stdout)
      if (result.stderr !== '') io.stderr.write(result.stderr)
      return result.exitCode
    }
    const output = await postToolUseOutput(context, policy)
    if (output !== '') io.stdout.write(output)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr.write(`vouchington hook ${parsed.event}: ${message}\n`)
    return blocking ? 2 : 0
  }
}

// A failing side effect (for example persisting a session id) is reported, never allowed to
// suppress the command policy or the post-tool-use checks.
async function runOnPayload(policy: HookPolicy, context: HookContext, io: HookIo): Promise<void> {
  try {
    await policy.onPayload?.(context)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr.write(`vouchington hook: onPayload failed: ${message}\n`)
  }
}
