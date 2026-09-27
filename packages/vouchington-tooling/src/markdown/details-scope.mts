import type { MarkdownSectionsDiagnostic } from './document-types.mts'

type DetailsFrame = { line: number; summary: 'absent' | 'open' | 'closed' }

/** Tracks disclosure tags from HTML nodes, never from fenced code or Markdown comments. */
export class DetailsScope {
  readonly diagnostics: MarkdownSectionsDiagnostic[] = []
  private readonly frames: DetailsFrame[] = []

  constructor(private readonly markdown: string) {}

  get visible(): boolean {
    return this.frames.length === 0
  }

  acceptHtml(html: string, startOffset: number): void {
    const tokens = /<!--[\s\S]*?(?:-->|$)|<\/?[a-z][a-z\d:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/giu
    for (const token of html.matchAll(tokens)) {
      if (token[0].startsWith('<!--')) continue
      const tag = /^<(\/?)([a-z][a-z\d:-]*)/iu.exec(token[0])!
      const name = tag[2]!.toLowerCase()
      if (name !== 'details' && name !== 'summary') continue
      const line = this.markdown.slice(0, startOffset + token.index).split('\n').length
      if (/\/\s*>$/u.test(token[0])) {
        this.problem(line, `${tag[2]} cannot be self-closing`)
        continue
      }
      this.acceptTag(name, tag[1] === '/', line)
    }
  }

  finish(): void {
    for (const frame of this.frames) this.problem(frame.line, 'details has no closing tag')
  }

  private acceptTag(name: string, closing: boolean, line: number): void {
    if (name === 'details') {
      if (!closing) {
        if (this.frames.at(-1)?.summary === 'open') {
          this.problem(line, 'details cannot open inside summary')
        }
        this.frames.push({ line, summary: 'absent' })
        return
      }
      const frame = this.frames.pop()
      if (!frame) this.problem(line, 'details closes without an opening tag')
      else if (frame.summary === 'open') this.problem(line, 'summary has no closing tag')
      return
    }
    const frame = this.frames.at(-1)
    if (!frame) {
      this.problem(line, 'summary must be inside details')
      return
    }
    if (closing) {
      if (frame.summary !== 'open') this.problem(line, 'summary closes without an opening tag')
      else frame.summary = 'closed'
    } else if (frame.summary !== 'absent') {
      this.problem(line, 'details contains more than one summary or a nested summary')
    } else frame.summary = 'open'
  }

  private problem(line: number, reason: string): void {
    this.diagnostics.push({
      code: 'malformed-details',
      line,
      message: `Malformed details: ${reason}.`,
    })
  }
}
