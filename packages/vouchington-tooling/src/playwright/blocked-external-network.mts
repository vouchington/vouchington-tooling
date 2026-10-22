import type { BrowserContext, Route } from '@playwright/test'
import type { BrowserIssueAllowlistEntry } from './browser-issue-records.mts'

const NOOP_ANALYTICS_SCRIPT = [
  'window.dataLayer = window.dataLayer || [];',
  'window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };',
].join('\n')

export interface BlockedExternalNetworkRule {
  pattern: RegExp
  reason: string
  response: Parameters<Route['fulfill']>[0]
}

export const BLOCKED_EXTERNAL_NETWORK_RULES: BlockedExternalNetworkRule[] = [
  {
    pattern: /^https:\/\/www\.googletagmanager\.com\/(?:gtm\.js|gtag\/js)(?:[?#].*)?$/,
    reason: 'Google Tag Manager is external telemetry and should not affect Playwright determinism',
    response: {
      body: NOOP_ANALYTICS_SCRIPT,
      contentType: 'application/javascript',
      status: 200,
    },
  },
  {
    pattern:
      /^https:\/\/(?:www\.|region1\.)?google-analytics\.com\/(?:collect|g\/collect|j\/collect|mp\/collect)(?:[?#].*)?$/,
    reason:
      'Google Analytics collection is external telemetry and should not affect Playwright determinism',
    response: {
      body: '',
      contentType: 'text/plain',
      status: 204,
    },
  },
  {
    pattern: /^https:\/\/analytics\.google\.com\/.*$/,
    reason:
      'Google Analytics UI endpoints are external telemetry and should not affect Playwright determinism',
    response: {
      body: '',
      contentType: 'text/plain',
      status: 204,
    },
  },
  {
    pattern: /^https:\/\/stats\.g\.doubleclick\.net\/.*$/,
    reason:
      'DoubleClick analytics requests are external telemetry and should not affect Playwright determinism',
    response: {
      body: '',
      contentType: 'text/plain',
      status: 204,
    },
  },
]

export function blockedExternalRequestFailureAllowlist(
  extra: readonly BrowserIssueAllowlistEntry[] = [],
  rules: readonly BlockedExternalNetworkRule[] = BLOCKED_EXTERNAL_NETWORK_RULES,
): BrowserIssueAllowlistEntry[] {
  return [
    ...rules.map((rule) => ({
      pattern: rule.pattern,
      reason: rule.reason,
      type: 'requestfailed' as const,
    })),
    ...extra,
  ]
}

export function isBlockedExternalNetworkUrl(
  url: string,
  rules: readonly BlockedExternalNetworkRule[] = BLOCKED_EXTERNAL_NETWORK_RULES,
) {
  return rules.some((rule) => {
    rule.pattern.lastIndex = 0
    return rule.pattern.test(url)
  })
}

/**
 * Playwright prefers the most recently registered matching route, so when two rules match the same
 * URL the later rule in `rules` wins.
 */
export async function installBlockedExternalNetwork(
  context: BrowserContext,
  rules: readonly BlockedExternalNetworkRule[] = BLOCKED_EXTERNAL_NETWORK_RULES,
) {
  const installed = rules.map((rule) => {
    const handler = (route: Route) => route.fulfill(rule.response)
    return { handler, pattern: rule.pattern }
  })
  await Promise.all(installed.map(({ handler, pattern }) => context.route(pattern, handler)))
  // Removes only the routes installed here, leaving caller-owned routes in place.
  return async () => {
    await Promise.all(
      installed.map(({ handler, pattern }) =>
        context.unroute(pattern, handler).catch(() => undefined),
      ),
    )
  }
}
