import { describe, expect, it } from 'vitest'

import {
  nextPageCursorFromLinkHeader,
  nextPageUrlFromLinkHeader,
  validatePaginationRequestUrl,
} from './index.mts'

const REQUEST_URL = 'https://api.example.test/resources?per_page=100&page=1'

describe('nextPageUrlFromLinkHeader', () => {
  it('resolves one same-origin next relation and ignores other relations', () => {
    const header = [
      '<https://api.example.test/resources?per_page=100&page=2>; rel="next"',
      '<https://api.example.test/resources?per_page=100&page=9>; rel="last"',
    ].join(', ')

    expect(nextPageUrlFromLinkHeader(header, REQUEST_URL)?.href).toBe(
      'https://api.example.test/resources?per_page=100&page=2',
    )
  })

  it('accepts a case-insensitive relation list, relative targets, and commas in quoted parameters', () => {
    const header = '</resources?cursor=cursor-2>; title="one, two"; rel="previous NEXT"'

    expect(nextPageUrlFromLinkHeader(header, REQUEST_URL)?.href).toBe(
      'https://api.example.test/resources?cursor=cursor-2',
    )
  })

  it('accepts an escaped character in a quoted relation parameter', () => {
    expect(
      nextPageUrlFromLinkHeader(
        '<https://api.example.test/resources?page=2>; rel="n\\ext"',
        REQUEST_URL,
      )?.href,
    ).toBe('https://api.example.test/resources?page=2')
  })

  it.each([
    undefined,
    null,
    '',
    '<https://api.example.test/resources?page=2>; rel="last"',
    '<https://api.example.test/resources?page=2>; rel="next",',
    'https://api.example.test/resources?page=2; rel="next"',
    '<https://api.example.test/resources?page=2; rel="next"',
    '<>; rel="next"',
    '<https://api.example.test/resources?page=2> unexpected',
    '<https://api.example.test/resources?page=2>; rel',
    '<https://api.example.test/resources?page=2>; =next',
    '<https://api.example.test/resources?page=2>; rel=',
    '<https://api.example.test/resources?page=2>; rel="next',
    '<https://api.example.test/resources?page=2>; rel="next\\',
    '<http://[>; rel="next"',
  ])('fails closed on absent or malformed Link header %j', (header) => {
    expect(nextPageUrlFromLinkHeader(header, REQUEST_URL)).toBeNull()
  })

  it.each([
    '<https://attacker.example.test/collect?cursor=secret>; rel="next"',
    '<http://api.example.test/resources?page=2>; rel="next"',
    '<https://token@api.example.test/resources?page=2>; rel="next"',
    '<https://api.example.test/resources?page=2#hidden>; rel="next"',
    '<https://api.example.test/resources?page=2>; rel="next", <https://api.example.test/resources?page=3>; rel="next"',
  ])('does not follow unsafe or ambiguous next target %s', (header) => {
    expect(nextPageUrlFromLinkHeader(header, REQUEST_URL)).toBeNull()
  })
})

describe('nextPageCursorFromLinkHeader', () => {
  it('fails closed when no safe next page exists', () => {
    expect(nextPageCursorFromLinkHeader(null, REQUEST_URL)).toBeNull()
  })

  it('returns the sole non-empty requested cursor parameter', () => {
    expect(
      nextPageCursorFromLinkHeader(
        '<https://api.example.test/resources?cursor=opaque%2Fvalue>; rel="next"',
        REQUEST_URL,
        'cursor',
      ),
    ).toBe('opaque/value')
  })

  it.each([
    '<https://api.example.test/resources>; rel="next"',
    '<https://api.example.test/resources?cursor=>; rel="next"',
    '<https://api.example.test/resources?cursor=one&cursor=two>; rel="next"',
  ])('fails closed on a missing, empty, or duplicate cursor %s', (header) => {
    expect(nextPageCursorFromLinkHeader(header, REQUEST_URL, 'cursor')).toBeNull()
  })
})

describe('validatePaginationRequestUrl', () => {
  it('accepts an absolute HTTP(S) request URL', () => {
    expect(validatePaginationRequestUrl(REQUEST_URL)).toBeInstanceOf(URL)
  })

  it.each([
    'relative/path',
    'ftp://api.example.test/resources',
    'https://token@api.example.test/resources',
    'https://api.example.test/resources#fragment',
  ])('rejects an unsafe pagination request URL %s', (requestUrl) => {
    expect(() => validatePaginationRequestUrl(requestUrl)).toThrow(
      'pagination request URL must be an absolute HTTP(S) URL without credentials',
    )
  })
})
