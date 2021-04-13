import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { Socket } from 'net';
import { ClientRequest, ClientRequestArgs, IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'http';
import * as EventEmitter from 'events';
import debug from 'debug';
import { v4 as uuid } from 'uuid';
import { wrap, unwrap } from 'shimmer';
import { FakeSocket } from './fake-socket';

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
  statusMessage: string;
  headers: Headers;
  body?: Buffer;
}

export interface RequestContext {
  timing: Timing;
  requestId: string;
  [name: string]: any;
}

export interface Timing {
  socket: {
    // socket::lookup
    lookup?: number;
    // socket::connect
    connect?: number;
    // socket::secureConnect
    tls?: number;
  }
  request: {
    // ClientRequest created
    initiated?: number;
    // request::abort
    abort?: number;
    // request::timeout
    timeout?: number;
    // request::write
    write?: number;
    // request::end
    end?: number;
  };
  response: {
    // response::data
    read?: number;
    // response::end
    end?: number;
    // response::error
    error?: number;
    // response::aborted
    aborted?: number;
  };
}

export type Event =
  | 'request.initiated'
  | 'request.sent'
  | 'response.received'
  | 'response.error';

type Listener<T extends Event> = T extends 'request.initiated'
  ? (request: ClientRequest, context: RequestContext) => void
  : T extends 'request.sent'
  ? (request: Request, context: RequestContext) => void
  : T extends 'response.received'
  ? (request: Request, response: Response, context: RequestContext) => void
  : T extends 'response.error'
  ? (error: Error) => void
  : never;

export type Stub = (request: Request) => Response

const log = debug('http-interceptor');

/**
 * This interceptor intercept low-level http ClientRequest so that all HTTP traffic can be visible, including
 * raw NodeJS http(s) requests, Axios, fetch, whatever.
 *
 * To apply the interception, make sure the interceptor is initialised as early as possible.
 */
export class HttpInterceptor {
  private emitter: EventEmitter;
  private enabled: boolean;
  stub?: Stub

  constructor(stub?: Stub) {
    this.emitter = new EventEmitter();
    this.stub = stub
  }

  enable() {
    if (!this.enabled) {
      this.wrap(http);
      this.wrap(https);
      this.enabled = !this.enabled;
    }
  }

  disable() {
    if (this.enabled) {
      unwrap(http, 'request');
      unwrap(https, 'request');
      this.enabled = !this.enabled;
    }
  }

  private wrap(http) {
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

        const context: RequestContext = {
          requestId: uuid(),
          timing: {
            socket: {},
            request: {
              initiated: now(),
            },
            response: {},
          },
        };
        this.emitter.emit('request.initiated', request, context);
        const req: Request = {
          url: this.resolveHttpRequestUrl(args),
          method: this.resolveHttpRequestMethod(args),
          headers: Object.assign({}, request.getHeaders()),
        };

        this.wrapRequest(request, req, context);

        if (this.stub) {
          const stubResponse = this.stub(req)
          if (stubResponse) {
            process.nextTick(() => {
              const incomingMessage = new IncomingMessage(new FakeSocket(args[0], { usesHttps: http === https }) as unknown as Socket)
              incomingMessage.statusCode = stubResponse.statusCode || 200
              incomingMessage.statusMessage = stubResponse.statusMessage || 'OK'
              incomingMessage.headers = {
                server: 'http-interceptor/stub',
                'content-type': 'application/octet-stream',
                date: new Date().toUTCString(),
                ...stubResponse.headers
              }
              incomingMessage.push(stubResponse.body)
              incomingMessage.push(null)
              incomingMessage.complete = true
              request.emit('response', incomingMessage)
            })
          }
        }

        return request;
      };
    });
  }

  private wrapRequest(
    request: ClientRequest,
    req: Request,
    context: RequestContext,
  ) {
    wrap(request, 'emit', (original) => {
      return (
        ...args: [
          'response' | 'socket' | 'abort' | 'timeout',
          IncomingMessage | Socket,
        ]
      ) => {
        try {
          const [eventName, response] = args;
          switch (eventName) {
            case 'socket': {
              this.wrapSocket(response as Socket, context);
              break;
            }
            case 'response': {
              this.wrapResponse(response as IncomingMessage, req, context);
              break;
            }
            case 'abort': {
              context.timing.request.abort = now();
              break;
            }
            // socket also has a timeout event, which is accurate?
            case 'timeout': {
              context.timing.request.timeout = now();
              break;
            }
          }
        } catch (err) {
          this.handleWrapperError(err);
        }

        return original.apply(request, args);
      };
    });

    const chunks = [];
    wrap(request, 'write', (original) => {
      return (...args) => {
        try {
          if (!context.timing.request.write) {
            context.timing.request.write = now();
          }
          const [chunk, encoding] = args;
          if (chunk && typeof chunk !== 'function') {
            chunks.push(
              typeof chunk === 'string'
                ? Buffer.from(chunk, encoding || 'utf-8')
                : chunk,
            );
          }
        } catch (err) {
          this.handleWrapperError(err);
        }

        return original.apply(request, args);
      };
    });

    wrap(request, 'end', (original) => {
      return (...args: [string | Buffer, BufferEncoding]) => {
        try {
          const time = now();
          if (!context.timing.request.write) {
            // never write, end directly when 0 byte body
            context.timing.request.write = time;
          }
          context.timing.request.end = time;
          const [chunk, encoding] = args;
          if (chunk && typeof chunk !== 'function') { // if no data, that is a callback
            chunks.push(
              typeof chunk === 'string'
                ? Buffer.from(chunk, encoding || 'utf-8')
                : chunk,
            );
          }

          req.body = Buffer.concat(chunks);
          this.emitter.emit('request.sent', Object.freeze(req), context);
        } catch (err) {
          this.handleWrapperError(err);
        }

        return original.apply(request, args);
      };
    });
  }

  private wrapResponse(
    response: IncomingMessage,
    req: Request,
    context: RequestContext,
  ) {
    const chunks = [];
    wrap(response, 'emit', (original) => {
      return (
        ...args: [
          'data' | 'end' | 'error' | 'aborted',
          string | Buffer | Error | undefined,
          any | undefined,
        ]
      ) => {
        try {
          const [eventName, data] = args;
          switch (eventName) {
            case 'data': {
              if (!context.timing.response.read) {
                context.timing.response.read = now();
              }
              chunks.push(
                typeof data === 'string'
                  ? Buffer.from(data, response.readableEncoding || 'utf-8')
                  : data,
              );
              break;
            }
            case 'end': {
              const time = now();
              if (!context.timing.response.read) {
                // never read, end directly when 0 byte body
                context.timing.response.read = time;
              }
              context.timing.response.end = time;
              const res = Object.freeze({
                statusCode: response.statusCode,
                statusMessage: response.statusMessage,
                headers: response.headers,
                body: Buffer.concat(chunks),
              });
              this.emitter.emit('response.received', req, res, context);
              break;
            }
            case 'error': {
              context.timing.response.error = now();
              this.emitter.emit('response.error', data);
              break;
            }
            case 'aborted': {
              context.timing.response.aborted = now();
              break;
            }
          }
        } catch (err) {
          this.handleWrapperError(err);
        }
        return original.apply(response, args);
      };
    });
  }

  private wrapSocket(socket: Socket, context: RequestContext) {
    wrap(socket, 'emit', (original) => {
      return (...args: [string]) => {
        const [eventName] = args;
        switch (eventName) {
          case 'lookup': {
            context.timing.socket.lookup = now();
            break;
          }
          case 'connect': {
            context.timing.socket.connect = now();
            break;
          }
          case 'secureConnect': {
            context.timing.socket.tls = now();
          }
        }

        return original.apply(socket, args);
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

  on<T extends Event>(event: T, listener: Listener<T>) {
    this.emitter.addListener(event, listener);
  }

  private handleWrapperError(error) {
    console.warn(`HttpInterceptor error ignored: ${error.message}`);
    log('interceptor error, ignore', error);
  }
}

function now() {
  return new Date().getTime();
}
