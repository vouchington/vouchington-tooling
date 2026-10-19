import type { Page } from '@playwright/test'

/**
 * Fulfill the Cloudflare Turnstile script with a synthetic `window.turnstile`
 * that resolves the widget synchronously. Background traffic from the real
 * script can keep `networkidle` from settling. The synthetic widget implements
 * render, reset, remove, and getResponse. Callers that reject the token on
 * the server should mock that request.
 */

const TURNSTILE_API_PATTERN = '**/turnstile/v0/api.js**'

export const DEFAULT_TURNSTILE_STUB_TOKEN = 'PLAYWRIGHT_TURNSTILE_TOKEN'
export const DEFAULT_TURNSTILE_STUB_ATTRIBUTE = 'data-pw'

export interface TurnstileStubOptions {
  attributeName?: string
  token?: string
}

function renderTurnstileStubScript(token: string, attributeName: string) {
  return `
;(function () {
  if (window.turnstile) return
  var fakeToken = ${JSON.stringify(token)}
  var handlers = new Map()
  window.turnstile = {
    render: function (container, params) {
      var id = 'pw-' + Math.random().toString(36).slice(2)
      container.replaceChildren()
      var widget = document.createElement('div')
      widget.setAttribute('role', 'group')
      widget.setAttribute('aria-label', 'Cloudflare Turnstile verification')
      widget.setAttribute(${JSON.stringify(attributeName)}, 'turnstile-widget')
      widget.textContent = 'Cloudflare Turnstile verification'
      container.appendChild(widget)
      handlers.set(id, params)
      queueMicrotask(function () {
        try { params && params.callback && params.callback(fakeToken) } catch (_) {}
      })
      return id
    },
    reset: function (id) {
      var params = handlers.get(id)
      if (!params) return
      queueMicrotask(function () {
        try { params.callback && params.callback(fakeToken) } catch (_) {}
      })
    },
    remove: function (id) { handlers.delete(id) },
    getResponse: function () { return fakeToken },
  }
})();
`
}

const stubbedPages = new WeakSet<Page>()

export async function installTurnstileStub(
  page: Page,
  options: TurnstileStubOptions = {},
): Promise<void> {
  if (stubbedPages.has(page)) return
  const token = options.token ?? DEFAULT_TURNSTILE_STUB_TOKEN
  const attributeName = options.attributeName ?? DEFAULT_TURNSTILE_STUB_ATTRIBUTE
  const body = renderTurnstileStubScript(token, attributeName)
  await page.route(TURNSTILE_API_PATTERN, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body,
    }),
  )
  stubbedPages.add(page)
}
