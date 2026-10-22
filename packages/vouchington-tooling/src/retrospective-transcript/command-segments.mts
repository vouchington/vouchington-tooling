// Commands are matched by command position, not by scanning for words anywhere in the string.
// Segmenting and quote handling belong to shell-parse.
export { splitCommandSegments } from '../shell-parse/index.mts'

const PACKAGE_RUNNERS = ['npx', 'pnpm', 'pnpx', 'yarn']

export function isPackageRunner(word: string | undefined): boolean {
  if (!word) return false
  return PACKAGE_RUNNERS.some((runner) => word === runner || word.endsWith(`/${runner}`))
}
