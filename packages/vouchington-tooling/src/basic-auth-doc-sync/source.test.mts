import { describe, expect, it } from 'vitest'
import { findBasicAuthExemptMethodsByPath, findBasicAuthExemptPaths } from './index.mts'

describe('basic-auth source facts', () => {
  it('extracts configured top-level typed constants with comments and static templates', () => {
    const source =
      'const ROUTES: ReadonlySet<string> = new Set([`/status`, "/service",])\n' +
      'const METHODS: ReadonlyMap<string, ReadonlySet<string>> = new Map([\n' +
      '  ["/status", new Set(["GET", "HEAD", /* probe */])],\n' +
      '  [`/service`, new Set(["POST"])],\n])'
    expect(findBasicAuthExemptPaths(source, 'ROUTES')).toEqual(['/status', '/service'])
    expect(findBasicAuthExemptMethodsByPath(source, 'METHODS')).toEqual(
      new Map([
        ['/status', ['GET', 'HEAD']],
        ['/service', ['POST']],
      ]),
    )
  })

  it('selects the requested symbol and ignores nested or unrelated declarations', () => {
    const source =
      'const OTHER = new Set(["/other"]);\n' +
      'function nested() { const ROUTES = new Set(["/nested"]); }\n' +
      'const ROUTES = new Set(["/selected"]);'
    expect(findBasicAuthExemptPaths(source, 'ROUTES')).toEqual(['/selected'])
    expect(findBasicAuthExemptPaths(source, 'MISSING')).toBeNull()
    expect(
      findBasicAuthExemptPaths(
        source.replace('const ROUTES = new Set(["/selected"]);', ''),
        'ROUTES',
      ),
    ).toBeNull()
  })

  it.each([
    'const ROUTES = new Set',
    'const ROUTES = new Set()',
    'const ROUTES;',
    'const { ROUTES } = config',
    'let ROUTES = new Set(["/status"])',
    'const ROUTES = new PathSet(["/status"])',
    'const ROUTES = new Set(getRoutes())',
    'const ROUTES = new Set([route])',
    'const ROUTES = new Set([`/${route}`])',
    'const ROUTES = new Set(["/" + "status"])',
    'const ROUTES = new Set([...routes])',
    'const ROUTES = new Set([])',
    'const ROUTES = new Set([""])',
  ])('rejects dynamic or unsupported path collections: %s', (source) => {
    expect(findBasicAuthExemptPaths(source, 'ROUTES')).toBeNull()
  })

  it.each([
    'const OTHER = 1',
    'const METHODS = new Map',
    'const METHODS = new Map()',
    'const METHODS = new Map([null])',
    'let METHODS = new Map([["/status", new Set(["GET"])]])',
    'const METHODS = new RouteMap([["/status", new Set(["GET"])]])',
    'const METHODS = new Map([["/status", methods]])',
    'const METHODS = new Map([["/status", new Set(["GET"]), "extra"]])',
    'const METHODS = new Map([[route, new Set(["GET"])]])',
    'const METHODS = new Map([["/status", new Set(["get"])]])',
    'const METHODS = new Map([["/status", new Set(["GET "])]])',
    'const METHODS = new Map([["/status", new Set(["GE(T"])]])',
    'const METHODS = new Map([["/status", new Set([])]])',
    'const METHODS = new Map([])',
  ])('rejects dynamic or noncanonical method collections: %s', (source) => {
    expect(findBasicAuthExemptMethodsByPath(source, 'METHODS')).toBeNull()
  })

  it('preserves literal order and duplicate methods for caller-owned validation', () => {
    expect(
      findBasicAuthExemptMethodsByPath(
        'const METHODS = new Map([["/status", new Set(["HEAD", "GET", "GET"])]])',
        'METHODS',
      ),
    ).toEqual(new Map([['/status', ['HEAD', 'GET', 'GET']]]))
  })
})
