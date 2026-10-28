import { basename } from 'node:path'

export interface MarkdownArticleInput {
  name: string
  source: string
}

export interface ParsedMarkdownArticle {
  slug?: string
  body: string
}

export type MarkdownArticleLinkReason = 'residual-md' | 'missing-target' | 'duplicate-slug'

export interface MarkdownArticleLinkOffender {
  name: string
  /** The offending href, or the shared slug for `duplicate-slug`. */
  href: string
  reason: MarkdownArticleLinkReason
}

export interface CheckMarkdownArticleLinksOptions {
  inputs: readonly MarkdownArticleInput[]
  /** Article route prefix, for example `/article/`. */
  routePrefix: string
  parse: (source: string) => ParsedMarkdownArticle
  rewrite: (body: string) => string
  render: (markdown: string) => string | Promise<string>
}

const EXTERNAL_HREF = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const HREF_ATTRIBUTE = /(?<=\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
const ENTITIES: Readonly<Record<string, string>> = {
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&lt;': '<',
  '&gt;': '>',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&(?:quot|#39|#x27|lt|gt);/gi, (e) => ENTITIES[e.toLowerCase()] as string)
    .replace(/&amp;/gi, '&')
}

function slugExists(catalog: ReadonlySet<string>, target: string): boolean {
  try {
    return catalog.has(decodeURIComponent(target))
  } catch {
    return false
  }
}

export function articleSlug(name: string, slug: string | undefined): string {
  return slug || basename(name, '.md')
}

function hrefsOf(html: string): string[] {
  return Array.from(html.matchAll(HREF_ATTRIBUTE), (match) =>
    decodeEntities(match[1] ?? match[2] ?? (match[3] as string)),
  )
}

function duplicateSlugOffenders(
  articles: readonly { name: string; slug: string }[],
): MarkdownArticleLinkOffender[] {
  const bySlug = new Map<string, string[]>()
  for (const { name, slug } of articles) bySlug.set(slug, [...(bySlug.get(slug) ?? []), name])
  return [...bySlug].flatMap(([slug, names]) =>
    names.length > 1
      ? names.map((name) => ({ name, href: slug, reason: 'duplicate-slug' as const }))
      : [],
  )
}

/**
 * Renders every article and reports local links that still end in `.md`, links to a
 * `<routePrefix><slug>` target no input provides, and slugs shared by more than one input.
 * The caller supplies the parser, link rewriter and renderer; none is bundled here.
 */
export async function checkMarkdownArticleLinks(
  options: CheckMarkdownArticleLinksOptions,
): Promise<MarkdownArticleLinkOffender[]> {
  const articles = options.inputs.map((input) => {
    const parsed = options.parse(input.source)
    return { name: input.name, slug: articleSlug(input.name, parsed.slug), body: parsed.body }
  })
  const catalog = new Set(articles.map((article) => article.slug))
  const offenders = duplicateSlugOffenders(articles)
  for (const { name, body } of articles) {
    const html = await options.render(options.rewrite(body))
    for (const href of hrefsOf(html)) {
      if (EXTERNAL_HREF.test(href)) continue
      const path = href.split(/[?#]/)[0] as string
      if (path.endsWith('.md')) {
        offenders.push({ name, href, reason: 'residual-md' })
      } else if (path.startsWith(options.routePrefix)) {
        const target = path.slice(options.routePrefix.length)
        if (!target.includes('/') && !slugExists(catalog, target)) {
          offenders.push({ name, href, reason: 'missing-target' })
        }
      }
    }
  }
  return offenders
}
