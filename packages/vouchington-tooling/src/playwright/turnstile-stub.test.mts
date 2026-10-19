import { describe, expect, it, vi } from 'vitest'
import type { Page, Route } from '@playwright/test'
import {
  DEFAULT_TURNSTILE_STUB_ATTRIBUTE,
  DEFAULT_TURNSTILE_STUB_TOKEN,
  installTurnstileStub,
} from './turnstile-stub.mts'

function createPage() {
  const routes: { body: string; pattern: string }[] = []
  const page = {
    route: vi.fn<(pattern: string, handler: (route: Route) => unknown) => Promise<void>>(
      async (pattern, handler) => {
        const route = {
          fulfill: (response: { body: string }) => {
            routes.push({ body: response.body, pattern })
          },
        }
        await handler(route as unknown as Route)
      },
    ),
  }
  return { page: page as unknown as Page, routes }
}

describe('installTurnstileStub', () => {
  it('fulfills the Turnstile script once with the default token and attribute', async () => {
    const { page, routes } = createPage()

    await installTurnstileStub(page)
    await installTurnstileStub(page)

    expect(routes).toHaveLength(1)
    expect(routes[0]?.pattern).toBe('**/turnstile/v0/api.js**')
    expect(routes[0]?.body).toContain(JSON.stringify(DEFAULT_TURNSTILE_STUB_TOKEN))
    expect(routes[0]?.body).toContain(JSON.stringify(DEFAULT_TURNSTILE_STUB_ATTRIBUTE))
  })

  it('embeds a caller token and attribute name', async () => {
    const { page, routes } = createPage()

    await installTurnstileStub(page, {
      attributeName: 'data-test-widget',
      token: 'caller-token',
    })

    expect(routes[0]?.body).toContain(JSON.stringify('caller-token'))
    expect(routes[0]?.body).toContain(JSON.stringify('data-test-widget'))
  })
})
