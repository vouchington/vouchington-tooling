/** One file's section of a (numbered) unified diff. */
export type DiffFile = { path: string; text: string; added: number; removed: number }

// Git quotes a path holding a tab, quote, or non-ASCII byte; the index shows it as Git printed it.
const HEADER = /^diff --git (?:"a\/.*"|a\/.*) (?:"b\/(.*)"|b\/(.*))$/u

/**
 * Splits a unified diff (plain or numbered) into per-file sections, so a reviewer of a large pull
 * request can read one file's changes at a time. Text before the first file header is dropped.
 */
export function splitDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: { path: string; lines: string[] } | undefined
  const flush = () => {
    if (current === undefined) return
    const hunks = current.lines.filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
    files.push({
      path: current.path,
      text: `${current.lines.join('\n')}\n`,
      // Numbered lines put the marker after the two number columns; plain lines start with it.
      added: hunks.filter((line) => /^(?:[ \d]{14})?\+/u.test(line)).length,
      removed: hunks.filter((line) => /^(?:[ \d]{14})?-/u.test(line)).length,
    })
  }
  for (const line of patch.split('\n')) {
    const header = HEADER.exec(line)
    if (header !== null) {
      flush()
      current = { path: (header[1] ?? header[2]) as string, lines: [] }
    }
    current?.lines.push(line)
  }
  flush()
  return files
}

/** Patch file name for the file at `index`; names never derive from pull request paths. */
export function diffFileName(index: number): string {
  return `${String(index + 1).padStart(4, '0')}.patch`
}

/** A markdown index of the per-file patches, largest change first. */
export function renderDiffIndex(files: readonly DiffFile[], dir: string): string {
  const rows = files
    .map((file, index) => ({ file, name: diffFileName(index) }))
    .sort((a, b) => b.file.added + b.file.removed - (a.file.added + a.file.removed))
    .map(({ file, name }) => `- \`${dir}/${name}\` +${file.added} -${file.removed} ${file.path}`)
  return [`# Changed files (${files.length})`, '', ...rows, ''].join('\n')
}
