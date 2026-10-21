import { createServer, type Socket } from 'node:net'

export function observeFixtureExit(path: string) {
  let socket: Socket | undefined
  let error: unknown
  const recordError = (failure: unknown) => {
    error ??= failure
  }
  let ready: () => void = () => {}
  let failReady: (failure: Error) => void = () => {}
  const started = new Promise<void>((resolve, reject) => {
    ready = resolve
    failReady = reject
  })
  let exited: () => void = () => {}
  const closed = new Promise<void>((resolve) => {
    exited = resolve
  })
  const server = createServer((connection) => {
    socket = connection
    let message = ''
    connection.on('data', (data) => {
      message += data.toString()
      if (message === 'ready\n') ready()
      else if (!'ready\n'.startsWith(message)) {
        const failure = new Error('Invalid owned process readiness')
        recordError(failure)
        failReady(failure)
      }
    })
    connection.once('error', (failure) => {
      recordError(failure)
      failReady(failure)
    })
    connection.once('close', () => {
      if (message !== 'ready\n') {
        const failure = new Error('Owned process closed before readiness')
        recordError(failure)
        failReady(failure)
      }
      exited()
    })
    connection.resume()
  })
  server.on('error', (failure) => {
    recordError(failure)
    failReady(failure)
  })
  void started.catch(recordError)
  return {
    started,
    closed,
    connected: () => socket !== undefined,
    open: () => socket?.destroyed === false,
    error: () => error,
    failStartup: failReady,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(path, resolve)
      }),
    releaseConnection: () => socket?.destroy(),
    closeListener: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve()
        server.close((failure) => (failure ? reject(failure) : resolve()))
      }),
  }
}
