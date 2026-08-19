import { runVitestBlobManifestCli } from '../../vitest-blob-manifest/cli.mts'

export function runVitestBlobManifestCommand(args: readonly string[]): number {
  try {
    runVitestBlobManifestCli(args)
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
