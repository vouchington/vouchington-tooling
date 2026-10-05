import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type ts from '@typescript/typescript6'
import {
  compilerHostProbesAreFresh,
  trackCompilerHost,
  type CompilerHostProbeSnapshot,
} from './freshness.mts'
import { readProgramConfiguration } from './program-configuration.mts'
import { settleBuild } from './settlement.mts'
import type {
  CompilerProgramCache,
  CompilerProgramCacheOptions,
  CompilerProgramGeneration,
  CompilerProgramSnapshot,
} from './program-types.mts'

type CachedProgram = CompilerProgramSnapshot & {
  signature: string
  probes(): CompilerHostProbeSnapshot
}

/**
 * Reuses a real Program while configuration, roots and recorded filesystem probes are unchanged.
 * Rebuilds release the cache's old generation before allocating another Program. Callers retaining
 * old snapshots still own those references; clear() cannot release caller data.
 */
export function createCompilerProgramCache(
  input: CompilerProgramCacheOptions,
): CompilerProgramCache {
  const api: typeof ts = input.ts ?? createRequire(import.meta.url)('@typescript/typescript6')
  const maximumAttempts = input.maximumAttempts ?? 3
  let cached: CachedProgram | undefined
  let buildCount = 0
  const readConfiguration = () => {
    try {
      return readProgramConfiguration(api, input)
    } catch (error) {
      cached = undefined
      throw error
    }
  }
  return {
    get buildCount() {
      return buildCount
    },
    clear() {
      cached = undefined
    },
    load() {
      const configuration = readConfiguration()
      if (
        cached?.signature === configuration.signature &&
        compilerHostProbesAreFresh(cached.probes())
      )
        return cached
      cached = undefined
      const settled = settleBuild(configuration, maximumAttempts, {
        buildAttempt(current) {
          const tracker = trackCompilerHost(api.createCompilerHost(current.parsed.options, true), {
            readFileReplay: 'when-filesystem-metadata-stable',
            ...input.tracking,
          })
          buildCount += 1
          const program = api.createProgram({
            host: tracker.host,
            options: current.parsed.options,
            rootNames: current.roots,
            ...(current.parsed.projectReferences && {
              projectReferences: current.parsed.projectReferences,
            }),
          })
          // Compiler consumers may issue more host reads after construction; retain their probes.
          return { configuration: current, probes: () => tracker.snapshot(), program }
        },
        confirmAttempt(current, value) {
          const confirmed = readConfiguration()
          return {
            configuration: confirmed,
            settled:
              current.signature === confirmed.signature &&
              compilerHostProbesAreFresh(value.probes()),
          }
        },
      })
      const selected = settled.configuration.selectedSources
      cached = {
        generation: Object.freeze({}) as CompilerProgramGeneration,
        program: settled.program,
        sourceFiles: settled.program
          .getSourceFiles()
          .filter((file) => !selected || selected.has(resolve(file.fileName))),
        signature: settled.configuration.signature,
        probes: settled.probes,
      }
      return cached
    },
  }
}
