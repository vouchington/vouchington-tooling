import type {
  MarkdownSectionsDiagnostic,
  MarkdownSectionsDocument,
  ValidateMarkdownSectionsOptions,
} from './document-types.mts'

/** Validates caller-owned headings and visible core content without inferring semantic relevance. */
export function validateMarkdownSections(
  document: MarkdownSectionsDocument,
  options: ValidateMarkdownSectionsOptions,
): MarkdownSectionsDiagnostic[] {
  const diagnostics = [...document.diagnostics]
  for (const heading of options.requiredHeadings) {
    const sections = document.sections.filter((section) => section.heading === heading)
    if (sections.length === 0) {
      diagnostics.push({
        code: 'missing-heading',
        heading,
        message: `Missing required section: ${heading}.`,
      })
      continue
    }
    if (sections.length > 1) {
      diagnostics.push({
        code: 'duplicate-heading',
        heading,
        line: sections[1]!.line,
        message: `Duplicate required section: ${heading}.`,
      })
    }
    for (const section of sections) {
      if (!section.hasVisibleContent) {
        diagnostics.push({
          code: 'empty-section',
          heading,
          line: section.line,
          message: `Required section has no visible prose, list, or table content: ${heading}.`,
        })
      }
    }
  }
  return diagnostics
}
