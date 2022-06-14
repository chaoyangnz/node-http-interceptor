import { HttpInterceptor } from './http-interceptor'
import { formatError, formatRequest, formatResponse } from './format'

;(() => {
  const interceptor = new HttpInterceptor()

  interceptor.on('request.sent', (request, context) => console.info(...formatRequest(request, context)))
  interceptor.on('response.received', (request, response, context) => console.info(...formatResponse(request, response, context)))
  interceptor.on('response.error', (request, error, context) => console.warn(...formatError(request, error, context)))

  interceptor.enable()

})()
