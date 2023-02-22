import { HttpInterceptor } from './http-interceptor'
import { formatError, formatRequest, formatResponse } from './format'

;(() => {
  const interceptor = new HttpInterceptor()

  const events = {
    'request.sent': false,
    'response.received': true,
    'response.error': true,
    'socket.error': true
  }
  if (process.env.NODE_HTTP_INTERCEPTOR_VERBOSE) {
    for(const event of Object.keys(events)) {
      events[event] = true
    }
  }
  if(events['request.sent']) {
    interceptor.on('request.sent', (request, context) => console.info(...formatRequest(request, context)))
  }
  if(events['response.received']) {
    interceptor.on('response.received', (request, response, context) => console.info(...formatResponse(request, response, context)))
  }
  if(events['response.error']) {
    interceptor.on('response.error', (request, error, context) => console.warn(...formatError(request, error, context)))
  }
  if(events['socket.error']) {
    interceptor.on('socket.error', (request, error, context) => console.warn(...formatError(request, error, context)))
  }

  interceptor.enable()

})()
