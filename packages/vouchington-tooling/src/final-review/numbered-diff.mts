const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

function pad(value: number | null): string {
  return (value === null ? '' : String(value)).padStart(6)
}

/**
 * Prefixes every diff body line with its LEFT (base) and RIGHT (head) file line numbers, so a
 * reviewer cites real file lines instead of counting from hunk headers or diff.patch offsets.
 * Hunk lengths bound each hunk, so an empty context line (`diff.suppressBlankEmpty`) still
 * advances both counters. Headers and lines outside hunks pass through unchanged.
 */
export function numberDiff(patch: string): string {
  let left = 0
  let right = 0
  let oldLeft = 0
  let newLeft = 0
  return patch
    .split('\n')
    .map((line) => {
      const hunk = HUNK.exec(line)
      if (hunk !== null) {
        left = Number(hunk[1])
        oldLeft = Number(hunk[2] ?? '1')
        right = Number(hunk[3])
        newLeft = Number(hunk[4] ?? '1')
        return line
      }
      if (line.startsWith('diff --git ')) {
        oldLeft = 0
        newLeft = 0
      }
      if (oldLeft <= 0 && newLeft <= 0) return line
      if (line.startsWith('+')) {
        newLeft -= 1
        return `${pad(null)} ${pad(right++)} ${line}`
      }
      if (line.startsWith('-')) {
        oldLeft -= 1
        return `${pad(left++)} ${pad(null)} ${line}`
      }
      if (line.startsWith(' ') || line === '') {
        oldLeft -= 1
        newLeft -= 1
        return `${pad(left++)} ${pad(right++)} ${line}`
      }
      return line
    })
    .join('\n')
}

/** Explains the numbered diff format to a reviewer. */
export const NUMBERED_DIFF_LEGEND =
  'Each diff line starts with two columns: the base (LEFT) line number and the head (RIGHT) line ' +
  'number. Cite those numbers. Never cite a line number of the diff file itself.'
