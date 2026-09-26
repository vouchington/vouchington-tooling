import { runRepoSccComplexity } from './repo-gate.mts'

process.exit(await runRepoSccComplexity())
