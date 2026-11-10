import type { MarkdownSectionsDiagnostic } from './document-types.mts'
import type { MarkdownSourcePosition } from './types.mts'

type PositionedBlock = { position: MarkdownSourcePosition }

/** Source-backed facts from content outside every details disclosure. */
export type MarkdownVisibleBlock =
  | (PositionedBlock & { kind: 'heading'; depth: number; text: string })
  | (PositionedBlock & { kind: 'paragraph'; text: string })
  | (PositionedBlock & { kind: 'list-item'; ordered: boolean; text: string })
  | (PositionedBlock & {
      kind: 'table'
      headers: string[]
      rows: Array<{ cells: string[]; position: MarkdownSourcePosition }>
    })
  | (PositionedBlock & { kind: 'fenced-code'; language: string | null; value: string })
  | (PositionedBlock & { kind: 'raw-html'; block: boolean; value: string })

export type MarkdownVisibleContent = {
  /** Visible prose in source order, counted once; code, images, comments, and HTML are excluded. */
  text: string
  blocks: MarkdownVisibleBlock[]
  diagnostics: MarkdownSectionsDiagnostic[]
}
