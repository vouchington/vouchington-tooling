export interface GithubActionsStepGroupSlice {
  header: string
  log: string
}

function findGithubActionsStepGroupStarts(log: string): number[] {
  return [...log.matchAll(/##\[group\]Run [^\n]*/g)].map((match) => match.index)
}

export function getGithubActionsStepGroupSlices(log: string): GithubActionsStepGroupSlice[] {
  const starts = findGithubActionsStepGroupStarts(log)

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? log.length
    const headerEnd = log.indexOf('\n', start)

    return {
      header: headerEnd === -1 ? log.slice(start, end) : log.slice(start, headerEnd),
      log: log.slice(start, end),
    }
  })
}

export function sliceGithubActionsStepGroup(log: string, runGroup: string): string {
  const start = log.indexOf(runGroup)
  if (start === -1) return ''

  const searchStart = start + runGroup.length
  const nextGroupIndex = log.slice(searchStart).search(/##\[group\]Run [^\n]*/)
  const end = nextGroupIndex === -1 ? log.length : searchStart + nextGroupIndex
  return log.slice(start, end)
}

const stepFailurePattern =
  /(?:Process completed with exit code 1\.|The action(?: '[^']+')? has timed out)/

export function terminalFailedGithubActionsStepLog(log: string): string {
  const slices = getGithubActionsStepGroupSlices(log)
  for (let index = slices.length - 1; index >= 0; index -= 1) {
    const stepLog = slices[index]!.log
    if (stepFailurePattern.test(stepLog)) return stepLog
  }
  return ''
}
