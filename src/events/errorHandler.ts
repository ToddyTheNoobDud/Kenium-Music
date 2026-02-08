const GLOBAL_HANDLER_FLAG = Symbol.for('kenium.errorHandlersRegistered')

const handleEvent = (type: any, fn: any) => {
  process.on(type, fn)
}

const logEvent = (eventType: string, message: any, origin: any) => {
  console.log(`${eventType}: ${message} ${origin}`)
}

if (!(process as any)[GLOBAL_HANDLER_FLAG]) {
  ;(process as any)[GLOBAL_HANDLER_FLAG] = true

  handleEvent('unhandledRejection', (reason: any, origin: any) => {
    logEvent('Unhandled Rejection', reason, origin)
  })
  handleEvent('uncaughtException', (error: any, origin: any) =>
    logEvent('Uncaught Exception', error, origin)
  )
  handleEvent('warning', (warning: any, origin: any) =>
    logEvent('Warning', warning, origin)
  )
  handleEvent('rejectionHandled', (promise: any, origin: any) =>
    logEvent('Rejection Handled', `Promise: ${promise}`, origin)
  )
  handleEvent('beforeExit', (code: any, origin: any) =>
    logEvent('Before Exit', `Code: ${code}`, origin)
  )
  handleEvent('exit', (code: any, origin: any) =>
    logEvent('Exit', `Code: ${code}`, origin)
  )
  handleEvent('uncaughtExceptionMonitor', (error: any, origin: any) =>
    logEvent('Uncaught Exception Monitor', error, origin)
  )
}
