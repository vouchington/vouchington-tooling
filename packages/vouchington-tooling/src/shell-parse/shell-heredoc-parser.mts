import { readHeredocDelimiter } from './shell-heredoc-delimiter.mts'
import {
  newHeredocLineState,
  stepHeredocQuoteState,
  type HeredocLineState,
} from './shell-heredoc-quote-state.mts'

export type HeredocSpec = {
  delimiter: string
  expandsSubstitutions: boolean
  stripLeadingTabs: boolean
}

export function heredocSpecsFromLine(line: string, carried?: HeredocLineState): HeredocSpec[] {
  const specs: HeredocSpec[] = []
  const state = carried ?? newHeredocLineState()
  let escaping = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (escaping) {
      escaping = false
      continue
    }

    if (char === '\\' && state.quote !== "'") {
      escaping = true
      continue
    }

    const consumed = stepHeredocQuoteState(state, char, line[index + 1])
    if (consumed !== undefined) {
      index += consumed
      continue
    }

    if (char === '#' && (index === 0 || /[\s;&|()]/.test(line[index - 1]!))) {
      break
    }

    if (char !== '<' || line[index + 1] !== '<') {
      continue
    }
    // `<<<` opens a here-string, whose word ends on this line: no body follows.
    if (line[index + 2] === '<') {
      index += 2
      continue
    }

    const stripLeadingTabs = line[index + 2] === '-'
    let cursor = index + (stripLeadingTabs ? 3 : 2)
    while (cursor < line.length && /\s/.test(line[cursor]!)) {
      cursor += 1
    }

    const delimiter = readHeredocDelimiter(line, cursor)
    if (delimiter !== null) {
      specs.push({
        delimiter: delimiter.value,
        expandsSubstitutions: delimiter.expandsSubstitutions,
        stripLeadingTabs,
      })
      index = delimiter.endIndex
    }
  }

  return specs
}
