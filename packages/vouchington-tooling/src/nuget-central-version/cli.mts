import { readFileSync, writeFileSync } from 'node:fs'

import { validateNugetUpdate } from './index.mts'

export function runNugetCentralVersionCli(args: readonly string[]): void {
  const [trustedPath, candidatePath, metadataPath, outputPath] = args
  if (!trustedPath || !candidatePath || !metadataPath || !outputPath || args.length !== 4) {
    throw new Error(
      'Usage: vouchington nuget-central-version <trusted-props> <candidate-props> <metadata-json> <output-props>',
    )
  }
  const candidateSource = readFileSync(candidatePath, 'utf8')
  validateNugetUpdate(
    readFileSync(trustedPath, 'utf8'),
    candidateSource,
    readFileSync(metadataPath, 'utf8'),
  )
  writeFileSync(outputPath, candidateSource)
}
