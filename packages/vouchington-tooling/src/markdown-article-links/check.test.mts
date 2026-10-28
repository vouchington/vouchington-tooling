import { describe, expect, it } from 'vitest'
import {
  articleSlug,
  checkMarkdownArticleLinks,
  type CheckMarkdownArticleLinksOptions,
} from './index.mts'

const ROUTE = '/article/'

function parse(source: string): { slug?: string; body: string } {
  const match = /^---\nslug: (.+)\n---\n([\s\S]*)$/.exec(source)
  return match ? { slug: match[1] as string, body: match[2] as string } : { body: source }
}

/** Turns relative `x.md` links, inline or reference-style, into `/article/x` links. */
function rewrite(body: string): string {
  const definitions = new Map<string, string>()
  const withoutDefinitions = body.replace(/^\[([^\]]+)\]: (\S+)$/gm, (_all, id, url) => {
    definitions.set(id, url)
    return ''
  })
  const inline = withoutDefinitions.replace(
    /\[([^\]]+)\]\[([^\]]+)\]/g,
    (_all, text, id) => `[${text}](${definitions.get(id) ?? ''})`,
  )
  return inline.replace(/\]\(\.\/([^)#?]+)\.md([^)]*)\)/g, `](${ROUTE}$1$2)`)
}

function render(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')
}

function check(
  inputs: CheckMarkdownArticleLinksOptions['inputs'],
  overrides: Partial<CheckMarkdownArticleLinksOptions> = {},
) {
  return checkMarkdownArticleLinks({
    inputs,
    routePrefix: ROUTE,
    parse,
    rewrite,
    render,
    ...overrides,
  })
}

describe('articleSlug', () => {
  it('prefers the explicit slug and falls back to the filename', () => {
    expect(articleSlug('guides/Intro.md', 'custom')).toBe('custom')
    expect(articleSlug('guides/Intro.md', undefined)).toBe('Intro')
    expect(articleSlug('guides/Intro.md', '')).toBe('Intro')
  })
})

describe('checkMarkdownArticleLinks slugs', () => {
  it('resolves links to an explicit frontmatter slug and to a filename slug', async () => {
    const offenders = await check([
      { name: 'a.md', source: '---\nslug: renamed\n---\nbody' },
      { name: 'b.md', source: 'See [a](./renamed.md) and [self](./b.md).' },
    ])
    expect(offenders).toEqual([])
  })

  it('does not match the file name once a slug overrides it', async () => {
    const offenders = await check([
      { name: 'a.md', source: '---\nslug: renamed\n---\nbody' },
      { name: 'b.md', source: '[a](/article/a)' },
    ])
    expect(offenders).toEqual([{ name: 'b.md', href: '/article/a', reason: 'missing-target' }])
  })

  it('reports every file that shares a slug', async () => {
    const offenders = await check([
      { name: 'a.md', source: '---\nslug: same\n---\nx' },
      { name: 'same.md', source: 'y' },
      { name: 'other.md', source: 'z' },
    ])
    expect(offenders).toEqual([
      { name: 'a.md', href: 'same', reason: 'duplicate-slug' },
      { name: 'same.md', href: 'same', reason: 'duplicate-slug' },
    ])
  })
})

describe('checkMarkdownArticleLinks links', () => {
  it('rewrites inline and reference-style links before rendering', async () => {
    const offenders = await check([
      { name: 'a.md', source: '[b](./b.md) and [b again][ref]\n\n[ref]: ./b.md' },
      { name: 'b.md', source: 'text' },
    ])
    expect(offenders).toEqual([])
  })

  it('reports missing targets for inline and reference links', async () => {
    const offenders = await check([
      { name: 'a.md', source: '[x](./gone.md) and [y][r]\n\n[r]: ./absent.md' },
    ])
    expect(offenders).toEqual([
      { name: 'a.md', href: '/article/gone', reason: 'missing-target' },
      { name: 'a.md', href: '/article/absent', reason: 'missing-target' },
    ])
  })

  it('reports residual .md hrefs the rewriter left behind', async () => {
    const offenders = await check([
      { name: 'a.md', source: '[x](other/page.md) <a href="docs/z.md">z</a>' },
    ])
    expect(offenders).toEqual([
      { name: 'a.md', href: 'other/page.md', reason: 'residual-md' },
      { name: 'a.md', href: 'docs/z.md', reason: 'residual-md' },
    ])
  })

  it('strips the query and fragment before judging a path', async () => {
    const offenders = await check([
      {
        name: 'a.md',
        source:
          '[ok](/article/a?x=1#top) [ok2](/article/a#frag) [bad](/article/nope?x=1) ' +
          '[bad2](/article/nope2#f) [md](page.md#top) [md2](page.md?x=1)',
      },
    ])
    expect(offenders).toEqual([
      { name: 'a.md', href: '/article/nope?x=1', reason: 'missing-target' },
      { name: 'a.md', href: '/article/nope2#f', reason: 'missing-target' },
      { name: 'a.md', href: 'page.md#top', reason: 'residual-md' },
      { name: 'a.md', href: 'page.md?x=1', reason: 'residual-md' },
    ])
  })

  it('exempts scheme and protocol-relative hrefs', async () => {
    const offenders = await check([
      {
        name: 'a.md',
        source:
          '[a](https://example.com/x.md) [b](mailto:me@example.com) [c](//cdn.example.com/y.md) ' +
          '[d](HTTP://example.com/article/nope) [e](git+ssh://host/z.md)',
      },
    ])
    expect(offenders).toEqual([])
  })

  it('ignores deeper or unrelated routes and nested article paths', async () => {
    const offenders = await check([
      {
        name: 'a.md',
        source: '[a](/article/a/comments) [b](/other/nope) [c](/article/) [d](#top) [e](/article)',
      },
    ])
    expect(offenders).toEqual([{ name: 'a.md', href: '/article/', reason: 'missing-target' }])
  })

  it('awaits an asynchronous renderer and honors a different route prefix', async () => {
    const offenders = await check([{ name: 'a.md', source: '[x](/posts/nope) [y](/posts/a)' }], {
      routePrefix: '/posts/',
      render: async (markdown) => render(markdown),
    })
    expect(offenders).toEqual([{ name: 'a.md', href: '/posts/nope', reason: 'missing-target' }])
  })

  it('passes the parsed body, not the raw source, through rewrite and render', async () => {
    const seen: string[] = []
    await check([{ name: 'a.md', source: '---\nslug: s\n---\nBODY' }], {
      rewrite: (body) => {
        seen.push(`rewrite:${body}`)
        return `R(${body})`
      },
      render: (markdown) => {
        seen.push(`render:${markdown}`)
        return ''
      },
    })
    expect(seen).toEqual(['rewrite:BODY', 'render:R(BODY)'])
  })

  it('only reads real href attributes, in any quoting style', async () => {
    const offenders = await check([
      {
        name: 'a.md',
        source:
          '<div data-href="gone.md"></div> <a href=\'single.md\'>s</a> <a href=bare.md>b</a> ' +
          '<a HREF = "spaced.md">p</a>',
      },
    ])
    expect(offenders.map((o) => o.href)).toEqual(['single.md', 'bare.md', 'spaced.md'])
  })

  it('decodes HTML entities in href values before classifying', async () => {
    const offenders = await check([
      {
        name: 'a.md',
        source:
          '<a href="/article/a?x=1&amp;y=2">ok</a> <a href="x&#39;y.md">q</a> ' +
          '<a href="&quot;z.md">r</a> <a href="/article/&lt;t&gt;">t</a> <a href="u&#x27;.md">u</a>',
      },
    ])
    expect(offenders).toEqual([
      { name: 'a.md', href: "x'y.md", reason: 'residual-md' },
      { name: 'a.md', href: '"z.md', reason: 'residual-md' },
      { name: 'a.md', href: '/article/<t>', reason: 'missing-target' },
      { name: 'a.md', href: "u'.md", reason: 'residual-md' },
    ])
  })

  it('decodes percent-encoded targets and reports malformed escapes', async () => {
    const offenders = await check([
      { name: 'café.md', source: '<a href="/article/caf%C3%A9">c</a>' },
      { name: 'hello world.md', source: '<a href="/article/hello%20world">h</a>' },
      {
        name: 'x.md',
        source: '<a href="/article/%E0%A4%A">bad</a> <a href="/article/nope%20x">n</a>',
      },
    ])
    expect(offenders).toEqual([
      { name: 'x.md', href: '/article/%E0%A4%A', reason: 'missing-target' },
      { name: 'x.md', href: '/article/nope%20x', reason: 'missing-target' },
    ])
  })

  it('returns nothing for no inputs', async () => {
    expect(await check([])).toEqual([])
  })
})
