import * as http from 'http';
import { ClientRequest, IncomingMessage, RequestOptions } from 'http';
import * as https from 'https';
import { URL } from 'url';
import { wrap, unwrap } from 'shimmer';
import * as EventEmitter from 'events';
import debug from 'debug';

export interface Headers {
  [name: string]: number | string | string[] | undefined;
}

export interface Request {
  url: string;
  method: string;
  headers: Headers;
  body?: Buffer;
}

export interface Response {
  statusCode: number;
  statusText: string;
  headers: Headers;
  body?: Buffer;
}

export interface RequestContext {
  [name: string]: any;
}

export type Event =
  | 'request.initiated'
  | 'request.sent'
  | 'response.received'
  | 'response.error';

type Callback<T extends Event> = T extends 'request.initiated'
  ? (request: ClientRequest, context: RequestContext) => void
  : T extends 'request.sent'
  ? (request: Request, context: RequestContext) => void
  : T extends 'response.received'
  ? (request: Request, response: Response, context: RequestContext) => void
  : T extends 'response.error'
  ? (error: any) => void
  : never;

const log = debug('http-interceptor');

/**
 * This interceptor intercept low-level http ClientRequest so that all HTTP traffic can be visible, including
 * raw NodeJS http(s) requests, Axios, fetch, whatever.
 *
 * To apply the interception, make sure the interceptor is initialised as early as possible.
 */
export class HttpInterceptor {
  emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.wrap(http);
    this.wrap(https);
  }

  disable() {
    this.unwrap(http);
    this.unwrap(https);
  }

  unwrap(http) {
    unwrap(http, 'request');
    unwrap(https, 'request');
  }

  wrap(http) {
    wrap(http, 'get', function (_) {
      return (...args) => {
        // eslint-disable-next-line prefer-spread
        const request = http.request.apply(http, args);
        request.end();
        return request;
      };
    });

    wrap(http, 'request', (original) => {
      return (...args) => {
        const request: ClientRequest = original.apply(http, args);
        const context: RequestContext = {};
        this.emitter.emit('request.initiated', request, context);
        const req: Request = {
          url: this.resolveHttpRequestUrl(args),
          method: this.resolveHttpRequestMethod(args),
          headers: Object.assign({}, request.getHeaders()),
        };

        wrap(request, 'emit', (original) => {
          return (...args: ['response', IncomingMessage]) => {
            try {
              const [eventName, response] = args;
              switch (eventName) {
                case 'response': {
                  const chunks = [];
                  wrap(response, 'emit', (original) => {
                    return (
                      ...args: ['data' | 'end' | 'error', any | undefined]
                    ) => {
                      try {
                        const [eventName, data] = args;
                        switch (eventName) {
                          case 'data': {
                            chunks.push(data);
                            break;
                          }
                          case 'end': {
                            const res = Object.freeze({
                              statusCode: response.statusCode,
                              statusText: response.statusMessage,
                              headers: response.headers,
                              body: Buffer.concat(chunks),
                            });
                            this.emitter.emit(
                              'response.received',
                              req,
                              res,
                              context,
                            );
                            break;
                          }
                          case 'error': {
                            this.emitter.emit('response.error', data);
                            break;
                          }
                        }
                      } catch (err) {
                        log('interceptor error, ignore', err);
                      }
                      return original.apply(response, args);
                    };
                  });
                }
              }
            } catch (err) {
              log('interceptor error, ignore', err);
            }

            return original.apply(request, args);
          };
        });

        const chunks = [];
        wrap(request, 'write', (original) => {
          return (...args) => {
            try {
              const [chunk, encoding] = args;
              if (chunk && typeof chunk !== 'function') {
                chunks.push(
                  typeof chunk === 'string'
                    ? Buffer.from(chunk, encoding || 'utf-8')
                    : chunk,
                );
              }
            } catch (err) {
              log('interceptor error, ignore', err);
            }

            return original.apply(request, args);
          };
        });

        wrap(request, 'end', (original) => {
          return (...args) => {
            try {
              const [chunk, encoding] = args;
              if (chunk && typeof chunk !== 'function') {
                chunks.push(
                  typeof chunk === 'string'
                    ? Buffer.from(chunk, encoding || 'utf-8')
                    : chunk,
                );
              }

              req.body = Buffer.concat(chunks);
              this.emitter.emit('request.sent', Object.freeze(req), context);
            } catch (err) {
              log('interceptor error, ignore', err);
            }

            return original.apply(request, args);
          };
        });

        return request;
      };
    });
  }

  private resolveHttpRequestUrl(args: any[]) {
    const urlOrOptions = args[0];
    if (typeof urlOrOptions === 'string') {
      return urlOrOptions;
    } else if (urlOrOptions instanceof URL) {
      return urlOrOptions.toString();
    } else if ('hostname' in urlOrOptions || 'host' in urlOrOptions) {
      const options: RequestOptions = urlOrOptions;
      const host = options.host || options.hostname;
      const port = options.port ? `:${options.port}` : '';
      const protocol =
        options.protocol ||
        (options.agent instanceof https.Agent ? 'https:' : 'http:');
      return `${protocol}//${host}${port}${options.path}`;
    } else {
      log('cannot resolve URL', args);
      return '<unknown>';
    }
  }

  private resolveHttpRequestMethod(args: any[]) {
    const urlOrOptions = args[0];
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
      const options: RequestOptions = args[1];
      return options.method;
    } else if ('method' in urlOrOptions) {
      const options: RequestOptions = urlOrOptions;
      return options.method;
    } else {
      log('cannot resolve method', args);
      return 'GET';
    }
  }

  on<T extends Event>(event: T, listener: Callback<T>) {
    this.emitter.addListener(event, listener);
  }
}
