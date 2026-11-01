const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u

function pad(value: number | null): string {
  return (value === null ? '' : String(value)).padStart(6)
}

/**
 * Prefixes every diff body line with its LEFT (base) and RIGHT (head) file line numbers, so a
 * reviewer cites real file lines instead of counting from hunk headers or diff.patch offsets.
 * Headers and lines outside hunks pass through unchanged.
 */
export function numberDiff(patch: string): string {
  let left = 0
  let right = 0
  let inHunk = false
  return patch
    .split('\n')
    .map((line) => {
      const hunk = HUNK.exec(line)
      if (hunk !== null) {
        left = Number(hunk[1])
        right = Number(hunk[2])
        inHunk = true
        return line
      }
      if (line.startsWith('diff --git ')) inHunk = false
      if (!inHunk) return line
      if (line.startsWith('+')) return `${pad(null)} ${pad(right++)} ${line}`
      if (line.startsWith('-')) return `${pad(left++)} ${pad(null)} ${line}`
      if (line.startsWith(' ')) return `${pad(left++)} ${pad(right++)} ${line}`
      return line
    })
    .join('\n')
}

/** Explains the numbered diff format to a reviewer. */
export const NUMBERED_DIFF_LEGEND =
  'Each diff line starts with two columns: the base (LEFT) line number and the head (RIGHT) line ' +
  'number. Cite those numbers. Never cite a line number of the diff file itself.'
