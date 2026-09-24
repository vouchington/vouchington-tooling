import { type Document, parseAllDocuments } from 'yaml'

/** The workspace graph document of `pnpm-lock.yaml` and the source offset where it begins. */
export interface PnpmLockfileGraphDocument {
  readonly document: Document.Parsed
  readonly start: number
}

/**
 * Parses `pnpm-lock.yaml` and returns its workspace graph document, or `undefined` when empty.
 *
 * When pnpm 12 enforces a `packageManager` pin, it writes the lockfile as two YAML documents: first
 * an env document that locks pnpm itself (`packageManagerDependencies`), then the workspace graph.
 * Older lockfiles hold only the graph. Either way, the graph is the last document.
 */
export function parsePnpmLockfileGraphDocument(
  source: string,
): PnpmLockfileGraphDocument | undefined {
  const documents = parseAllDocuments(source)
  if (documents.length > 2) {
    throw new Error(
      `expected a pnpm lockfile to contain at most 2 YAML documents, found ${documents.length}`,
    )
  }
  for (const document of documents) {
    const [error] = document.errors
    if (error) throw error
  }
  const document = documents.at(-1)
  return document && { document, start: document.range[0] }
}

/** Parses `pnpm-lock.yaml` and returns its workspace graph as plain data. */
export function parsePnpmLockfileGraph(source: string): unknown {
  return parsePnpmLockfileGraphDocument(source)?.document.toJS() ?? null
}
