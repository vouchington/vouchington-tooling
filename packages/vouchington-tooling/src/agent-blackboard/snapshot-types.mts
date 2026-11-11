export type SnapshotSelection = {
  agent?: string
  version?: string
  parentSessionId?: string | null
  data?: Record<string, unknown>
  dataArrayContains?: Record<string, string>
  inactiveForHours?: number
}

export type SnapshotCounts = {
  sessions: number
  entries: number
  records: number
  bytes: number
}

export type SnapshotManifest = {
  schemaVersion: 1
  status: 'complete'
  createdAt: string
  completedAt: string
  selection: SnapshotSelection & { archived: false }
  counts: Omit<SnapshotCounts, 'bytes'>
  ordering: { sessions: 'createdAt ascending'; entries: 'createdAt ascending within session' }
  consistency: 'best-effort'
}

export type SnapshotChecksum = { algorithm: 'sha256'; value: string }

export type SnapshotPartitionOptions = {
  path: string
  checksum?: SnapshotChecksum
  counts?: SnapshotCounts
  maxSessions?: number
  maxBytes?: number
  owner?: SnapshotCleanupOwner
}

export type SnapshotPartition = {
  path: string
  counts: SnapshotCounts
  checksum: SnapshotChecksum
  manifest: SnapshotManifest
}

/** Who exported a snapshot and the generated file it came from, signed into the receipt. */
export type SnapshotCleanupOwner = { sessionId: string; worktree: string; source: string }

export type SnapshotCleanupReceipt = {
  schemaVersion: 1
  directory: string
  directoryDev: number
  directoryIno: number
  token: string
  partitions: Array<{ name: string; checksum: SnapshotChecksum }>
  owner?: SnapshotCleanupOwner
  signature: string
}

export type SnapshotPartitionResult = {
  directory: string
  partitions: SnapshotPartition[]
  cleanupReceipt: SnapshotCleanupReceipt
}

export type SnapshotCleanupOptions = {
  path?: string
  directory?: string
  receipt?: SnapshotCleanupReceipt
}
