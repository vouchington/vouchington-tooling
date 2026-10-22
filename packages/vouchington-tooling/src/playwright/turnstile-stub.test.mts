import { runInNewContext } from 'node:vm'
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

  it('retries the route when the first install fails', async () => {
    let calls = 0
    const page = {
      route: vi.fn<() => Promise<void>>(async () => {
        calls += 1
        if (calls === 1) throw new Error('route failed')
      }),
    } as unknown as Page

    await expect(installTurnstileStub(page)).rejects.toThrow('route failed')
    await installTurnstileStub(page)

    expect(calls).toBe(2)
  })

  describe('synthetic widget', () => {
    function loadStub() {
      const container = {
        appended: [] as unknown[],
        replaceChildren: vi.fn<() => void>(),
        appendChild(child: unknown) {
          this.appended.push(child)
        },
      }
      const created: Array<{ attributes: Record<string, string>; textContent?: string }> = []
      const querySelector = vi.fn<(selector: string) => unknown>((selector) =>
        selector === '#captcha' ? container : null,
      )
      const document = {
        createElement: () => {
          const element = {
            attributes: {} as Record<string, string>,
            setAttribute(name: string, value: string) {
              this.attributes[name] = value
            },
          }
          created.push(element)
          return element
        },
        querySelector,
      }
      const window: { turnstile?: { render: (target: unknown, params?: unknown) => string } } = {}
      return { container, created, document, querySelector, window }
    }

    async function render(target: unknown) {
      const { page, routes } = createPage()
      await installTurnstileStub(page)
      const env = loadStub()
      runInNewContext(routes[0]?.body ?? '', {
        document: env.document,
        queueMicrotask,
        window: env.window,
      })
      const callback = vi.fn<(token: string) => void>()
      const id = env.window.turnstile?.render(target, { callback })
      await Promise.resolve()
      return { ...env, callback, id }
    }

    it('resolves a selector-string container before clearing it', async () => {
      const { callback, container, created, id, querySelector } = await render('#captcha')

      expect(querySelector).toHaveBeenCalledWith('#captcha')
      expect(container.replaceChildren).toHaveBeenCalledOnce()
      expect(container.appended).toEqual(created)
      expect(id).toMatch(/^pw-/)
      expect(callback).toHaveBeenCalledWith(DEFAULT_TURNSTILE_STUB_TOKEN)
    })

    it('accepts an element container directly', async () => {
      const { page, routes } = createPage()
      await installTurnstileStub(page)
      const env = loadStub()
      runInNewContext(routes[0]?.body ?? '', {
        document: env.document,
        queueMicrotask,
        window: env.window,
      })

      env.window.turnstile?.render(env.container)

      expect(env.container.replaceChildren).toHaveBeenCalledOnce()
      expect(env.querySelector).not.toHaveBeenCalled()
    })

    it('throws when a selector matches no element', async () => {
      await expect(render('#missing')).rejects.toThrow('Turnstile container not found')
    })
  })
})
