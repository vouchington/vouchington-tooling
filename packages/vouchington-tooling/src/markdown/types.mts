import type { Heading, Root, RootContent } from 'mdast'
import type { Position } from 'unist'

export type MarkdownNode = Root | RootContent

/** A source range measured in JavaScript string offsets and 1-indexed source coordinates. */
export type MarkdownSourcePosition = {
  start: { line: number; column: number; offset: number }
  end: { line: number; column: number; offset: number }
}

/** A source-backed Markdown span with no dependency on mdast node types. */
export type MarkdownSourceSpan = {
  kind: 'code' | 'inline-code' | 'html'
  position: MarkdownSourcePosition
  value: string
}

export type MarkdownHtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** HTML parser facts distinguish block parsing from inline HTML in a phrasing container. */
export type MarkdownHtmlFact = {
  commonMarkType: MarkdownHtmlBlockType | null
  kind: 'block' | 'inline'
  position: MarkdownSourcePosition
  value: string
}

export type MarkdownTableRow = {
  cells: string[]
  line: number
}

export type PositionedMarkdownTable = {
  position?: Position
  rows: MarkdownTableRow[]
}

export type MarkdownTextOptions = {
  inlineCode?: 'content' | 'markers'
  issueReferences?: 'text' | 'brackets'
  whitespace?: 'preserve' | 'collapse'
}

export type ParseMarkdownTablesOptions = {
  preserveInlineCodeMarkers?: boolean
}

export type MarkdownSectionOptions = {
  endBoundary?: 'same-or-higher' | 'any'
}

export type LooseMarkdownTableRowsOptions = {
  excludePositions?: readonly Position[]
}

export type MarkdownSection = {
  content: string
  endHeading: Heading | null
  endOffset: number
  startHeading: Heading
  startOffset: number
}

export type LooseMarkdownTableRow = MarkdownTableRow & {
  offset: number
}
