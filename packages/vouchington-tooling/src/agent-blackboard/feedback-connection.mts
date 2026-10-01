import { resolveBlackboardConnection, type BlackboardConnection } from './client.mts'
import { FeedbackDeliveryError } from './feedback-online-error.mts'

/**
 * Resolves the blackboard connection and refuses to send the token anywhere but https, or http on
 * loopback, and never to a URL that embeds credentials. Every path that uses the token starts here.
 */
export function resolveFeedbackConnection(env?: NodeJS.ProcessEnv): BlackboardConnection {
  try {
    const connection = resolveBlackboardConnection(env)
    const url = new URL(connection.baseUrl)
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    )
      throw new Error('invalid connection URL')
    return connection
  } catch {
    throw new FeedbackDeliveryError('configuration-invalid')
  }
}
