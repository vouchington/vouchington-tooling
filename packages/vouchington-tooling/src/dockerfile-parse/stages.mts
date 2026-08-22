import { Cmd, Copy, From, Run, type Dockerfile } from 'dockerfile-ast'

export type StageInstruction = From | Copy | Cmd | Run

export interface ParsedStage {
  stage: string
  instructions: StageInstruction[]
}

export function collectStages(parser: Dockerfile): ParsedStage[] {
  const stages: ParsedStage[] = []
  let currentStage: ParsedStage | undefined

  for (const instruction of parser.getInstructions()) {
    if (instruction instanceof From) {
      const stage = instruction.getBuildStage() ?? String(stages.length)
      currentStage = { stage, instructions: [instruction] }
      stages.push(currentStage)
      continue
    }

    if (
      currentStage &&
      (instruction instanceof Copy || instruction instanceof Cmd || instruction instanceof Run)
    ) {
      currentStage.instructions.push(instruction)
    }
  }

  return stages
}
