import type { Heading, Root, RootContent } from 'mdast'
import type { Position } from 'unist'

export type MarkdownNode = Root | RootContent

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
