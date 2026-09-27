export type MarkdownVisibleSection = {
  heading: string
  content: string
  startOffset: number
  endOffset: number
  line: number
  hasVisibleContent: boolean
}

export type MarkdownSectionsDiagnostic = {
  code: 'missing-heading' | 'duplicate-heading' | 'empty-section' | 'malformed-details'
  message: string
  heading?: string
  line?: number
}

export type MarkdownSectionsDocument = {
  sections: MarkdownVisibleSection[]
  diagnostics: MarkdownSectionsDiagnostic[]
}

export type ValidateMarkdownSectionsOptions = {
  requiredHeadings: readonly string[]
}
