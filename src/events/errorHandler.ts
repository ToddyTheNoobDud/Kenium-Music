const GLOBAL_HANDLER_FLAG = Symbol.for('kenium.errorHandlersRegistered')

type ProcessWithFlags = NodeJS.Process & Record<symbol, boolean | undefined>

const logEvent = (eventType: string, message: unknown, origin?: unknown) => {
  console.error(`${eventType} (Origin: ${origin}):`, message)
}

const flaggedProcess = process as ProcessWithFlags

if (!flaggedProcess[GLOBAL_HANDLER_FLAG]) {
  flaggedProcess[GLOBAL_HANDLER_FLAG] = true

  process.on('unhandledRejection', (reason, promise) => {
    logEvent('Unhandled Rejection', reason, promise)
  })
  process.on('uncaughtException', (error, origin) => {
    logEvent('Uncaught Exception', error, origin)
    process.exit(1)
  })
  process.on('warning', (warning) => logEvent('Warning', warning))
  process.on('rejectionHandled', (promise) =>
    logEvent('Rejection Handled', `Promise: ${String(promise)}`)
  )
  process.on('beforeExit', (code) =>
    logEvent('Before Exit', `Code: ${String(code)}`)
  )
  process.on('exit', (code) => logEvent('Exit', `Code: ${String(code)}`))
  process.on('uncaughtExceptionMonitor', (error, origin) =>
    logEvent('Uncaught Exception Monitor', error, origin)
  )
}
