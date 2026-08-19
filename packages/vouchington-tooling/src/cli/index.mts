#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readPackageVersion } from '../package-version.mts'
import { runGhaRuntimeAudit } from './commands/gha-runtime-audit.mts'
import { runRunnerPortPolicy } from './commands/runner-port-policy.mts'
import { runWithHostLock } from './commands/with-host-lock.mts'
import { parseCli } from './parse.mts'
import { printUsage } from './usage.mts'

export function runCli(argv: readonly string[] = process.argv): number | Promise<number> {
  const parsed = parseCli(argv)
  switch (parsed.kind) {
    case 'help':
      printUsage()
      return 0
    case 'version':
      process.stdout.write(`${readInstalledVersion()}\n`)
      return 0
    case 'error':
      process.stderr.write(`vouchington: ${parsed.message}\n`)
      printUsage(process.stderr)
      return 2
    case 'runner-port-policy':
      return runRunnerPortPolicy(parsed)
    case 'with-host-lock':
      return runWithHostLock(parsed.args)
    case 'gha-runtime-audit':
      return runGhaRuntimeAudit(parsed)
  }
}

function readInstalledVersion(): string {
  return readPackageVersion(
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')),
  )
}

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return metaUrl === pathToFileURL(resolve(argv1)).href
  }
}

/* v8 ignore next 8 */
if (isMainModule(import.meta.url, process.argv[1])) {
  const result = runCli()
  if (typeof result === 'number') process.exitCode = result
  else {
    result.then(
      (code) => {
        process.exitCode = code
      },
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
      },
    )
  }
}
