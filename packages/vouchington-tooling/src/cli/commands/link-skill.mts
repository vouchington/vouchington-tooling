import { linkSkill } from '../../skill-discovery/index.mts'

export async function runLinkSkill(options: {
  name: string
  sourceRoot: string
  targetRoot: string
}): Promise<number> {
  const result = await linkSkill(options)
  process.stdout.write(`${result.created ? 'linked' : 'already-linked'} ${result.path}\n`)
  return 0
}
