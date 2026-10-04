import { parseGfmMarkdown, walkMarkdown } from './ast.mts'

/** True when the GFM parse contains at least one unchecked task-list item. */
export function hasUncheckedMarkdownTask(markdown: string): boolean {
  let unchecked = false
  walkMarkdown(parseGfmMarkdown(markdown), (node) => {
    if (node.type === 'listItem' && node.checked === false) unchecked = true
  })
  return unchecked
}
