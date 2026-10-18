export interface WorktreeRecord {
  readonly path: string
  readonly branch?: string
  readonly locked: boolean
  readonly bare: boolean
  readonly detached: boolean
}

const BRANCH_PREFIX = 'branch refs/heads/'

function parseRecord(fields: readonly string[]): WorktreeRecord | undefined {
  const path = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length)
  if (path === undefined) return undefined
  const branch = fields
    .find((field) => field.startsWith(BRANCH_PREFIX))
    ?.slice(BRANCH_PREFIX.length)
  return {
    path,
    locked: fields.some((field) => field === 'locked' || field.startsWith('locked ')),
    bare: fields.includes('bare'),
    detached: fields.includes('detached'),
    ...(branch === undefined ? {} : { branch }),
  }
}

/** Parses `git worktree list --porcelain -z` (NUL fields, an empty field ends each record). */
export function parseWorktreeList(porcelain: string | undefined): WorktreeRecord[] {
  const records: WorktreeRecord[] = []
  let fields: string[] = []
  for (const field of [...(porcelain ?? '').split('\0'), '']) {
    if (field !== '') {
      fields.push(field)
      continue
    }
    const record = parseRecord(fields)
    if (record !== undefined) records.push(record)
    fields = []
  }
  return records
}
