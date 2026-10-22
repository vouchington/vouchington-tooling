import type { Page, Request, Response } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { installImageResponseGuard } from './expect-no-broken-images.mts'

type Handler = (value: Request | Response) => void

function createPage(): {
  page: Page
  emit: (event: 'response' | 'requestfailed', value: Request | Response) => void
} {
  const handlers = new Map<string, Handler>()
  const page = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler)
    },
  } as unknown as Page
  return {
    page,
    emit: (event, value) => {
      handlers.get(event)?.(value)
    },
  }
}

function response(status: number, resourceType: string, url: string): Response {
  return {
    status: () => status,
    url: () => url,
    request: () => ({ resourceType: () => resourceType }),
  } as unknown as Response
}

function failedRequest(resourceType: string, url: string): Request {
  return {
    resourceType: () => resourceType,
    url: () => url,
  } as unknown as Request
}

describe('installImageResponseGuard', () => {
  it('ignores healthy responses and non-image failures', () => {
    const { page, emit } = createPage()
    const guard = installImageResponseGuard(page)

    emit('response', response(200, 'image', 'https://cdn.example/ok.png'))
    emit('response', response(304, 'image', 'https://cdn.example/cached.png'))
    emit('response', response(404, 'document', 'https://cdn.example/missing.html'))
    emit('requestfailed', failedRequest('stylesheet', 'https://cdn.example/site.css'))

    expect(() => guard.assertNoImageFailures()).not.toThrow()
  })

  it('reports image responses outside 2xx/3xx and failed image requests', () => {
    const { page, emit } = createPage()
    const guard = installImageResponseGuard(page)

    emit('response', response(199, 'image', 'https://cdn.example/early.png'))
    emit('response', response(404, 'image', 'https://cdn.example/missing.png'))
    emit('requestfailed', failedRequest('image', 'https://cdn.example/dropped.png'))

    expect(() => guard.assertNoImageFailures()).toThrow(
      [
        '3 image(s) failed to load:',
        '  199 https://cdn.example/early.png',
        '  404 https://cdn.example/missing.png',
        '  failed https://cdn.example/dropped.png',
      ].join('\n'),
    )
  })
})
