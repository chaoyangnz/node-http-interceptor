import {
  HttpInterceptor,
  RequestContext,
  Response,
  Request,
  Headers,
  Stub,
} from './http-interceptor';
import { transform, truncate, cloneDeep } from 'lodash';
import * as mime from 'content-type';
import { ClientRequest } from 'http';
import axios from 'axios';
import * as http from 'http';
import * as https from 'https';
import * as nock from 'nock'

const log = jest.fn().mockImplementation((...args) => {
  console.info(...args);
});

const warn = jest.fn().mockImplementation((...args) => {
  console.warn(...args);
});

describe('HttpInterceptor', () => {
  describe('hooks', () => {

    let httpInterceptor: HttpInterceptor;

    beforeEach(() => {
      httpInterceptor = new HttpInterceptor();
      httpInterceptor.on('request.initiated', onRequestInitiated);
      httpInterceptor.on('request.sent', onRequestSent);
      httpInterceptor.on('response.received', onResponseReceived);
      httpInterceptor.on('response.error', onResponseError);
      httpInterceptor.on('socket.error', onSocketError);
      httpInterceptor.enable();
    });

    afterEach(() => {
      httpInterceptor.disable();
      jest.clearAllMocks();
    });

    it('should wrap http.request', async () => {
      const res = await axios.get<string>('https://chao.yang.so');
      expect(res.data).toBeTruthy();
      expect((http.request as any).__wrapped).toBeTruthy();
      expect((https.request as any).__wrapped).toBeTruthy();

      expect(log.mock.calls[0][2]).toEqual(log.mock.calls[1][2]); // requestId
      expect(log.mock.calls[0][3]).toEqual(log.mock.calls[1][3]); // request
      assertRequestListener();
      assertResponseListener();

      function assertRequestListener() {
        const [message, timing, requestId, request] = log.mock.calls[0];
        expect(message).toEqual('🔵 GET https://chao.yang.so/');
        expect(timing.socket).toEqual({});
        expect(timing.request.initiated).toBeGreaterThan(0);
        expect(timing.request.write).toBeGreaterThanOrEqual(
          timing.request.initiated,
        );
        expect(timing.request.end).toBeGreaterThanOrEqual(timing.request.write);
        expect(requestId.length).toEqual(36);
        expect(request).toMatchObject({
          url: 'https://chao.yang.so/',
          method: 'GET',
          headers: {
            accept: 'application/json, text/plain, */*',
            'user-agent': 'no-name',
            host: 'chao.yang.so',
          },
          body: '<0 bytes binary>',
        });
      }

      function assertResponseListener(...args) {
        const [message, timing, requestId, request, response] = log.mock.calls[1];
        expect(message).toEqual('🟢 200 GET https://chao.yang.so/');
        expect(timing.socket.lookup).toBeGreaterThan(0);
        expect(timing.socket.connect).toBeGreaterThan(timing.socket.lookup);
        expect(timing.socket.tls).toBeGreaterThan(timing.socket.lookup);
        expect(timing.request.initiated).toBeGreaterThan(0);
        expect(timing.request.write).toBeGreaterThanOrEqual(
          timing.request.initiated,
        );
        expect(timing.request.end).toBeGreaterThanOrEqual(timing.request.write);
        expect(timing.response.read).toBeGreaterThan(0);
        expect(timing.response.end).toBeGreaterThanOrEqual(timing.response.read);
        expect(requestId.length).toEqual(36);
        expect(request).toMatchObject({
          url: 'https://chao.yang.so/',
          method: 'GET',
          headers: {
            accept: 'application/json, text/plain, */*',
            'user-agent': 'no-name',
            host: 'chao.yang.so',
          },
          body: '<0 bytes binary>',
        });
        expect(response).toMatchObject({
          statusCode: 200,
          statusMessage: 'OK',
          headers: {
            'content-type': 'text/html; charset=UTF-8',
            'transfer-encoding': 'chunked',
            server: 'cloudflare',
          },
        });
        expect(response.body.length).toBeGreaterThan(0);
      }
    });

    it('should unwrap http.request', async () => {
      httpInterceptor.disable();
      const response = await axios.get<string>('https://chao.yang.so');
      expect(response.data).toBeTruthy();
      expect((http.request as any).__wrapped).toBeFalsy();
      expect((https.request as any).__wrapped).toBeFalsy();
      expect(log).not.toHaveBeenCalled();
    });

    it('should trigger socket.event', async () => {

      try {
        await axios.get('https://chao.yang.to/test')
      } catch (e) {
        // ignore
      }

      expect(warn).toHaveBeenCalledTimes(1)
    })
  })

  describe('body peek', () => {
    let httpInterceptor: HttpInterceptor;

    beforeEach(() => {
      httpInterceptor = new HttpInterceptor({
        peekRequestBody(request: Omit<Request, 'body'>): boolean {
          return false
        },
        peekResponseBody(response: Omit<Response, 'body'>): boolean {
          return false
        }
      })
      httpInterceptor.on('request.initiated', onRequestInitiated);
      httpInterceptor.on('request.sent', onRequestSent);
      httpInterceptor.on('response.received', onResponseReceived);
      httpInterceptor.on('response.error', onResponseError);
      httpInterceptor.enable()
    })

    afterEach(() => {
      httpInterceptor.disable()
      jest.clearAllMocks()
    })

    it('should not peek request body and response body', async () => {
      const res = await axios.get<string>('https://chao.yang.so');
      expect(res.data).toBeTruthy()
      expect(log).toHaveBeenCalledTimes(2)
      const request = log.mock.calls[0][3];
      expect(request.body).toBe('<unread>')
      const response = log.mock.calls[1][4];
      expect(response.body).toBe('<unread>')
    });
  })

  describe('stub', () => {
    let httpInterceptor: HttpInterceptor;

    beforeEach(() => {
      httpInterceptor = new HttpInterceptor();
      httpInterceptor.on('request.initiated', onRequestInitiated);
      httpInterceptor.on('request.sent', onRequestSent);
      httpInterceptor.on('response.received', onResponseReceived);
      httpInterceptor.on('response.error', onResponseError);
      const stub: Stub = (request) => {
        return {
          statusCode: 200,
          statusMessage: 'OK',
          headers: {
            'content-type': 'text/plain',
          },
          body: Buffer.from('test'),
        };
      };
      httpInterceptor.stub(stub);
      httpInterceptor.enable();
    });

    afterEach(() => {
      httpInterceptor.unstub();
      httpInterceptor.disable();
      jest.clearAllMocks();
    });

    it('should wrap http.request and response with the stubbed', async () => {
      const res = await axios.get<string>('https://chao.yang.so');
      expect(res.data).toBeTruthy();
      expect((http.request as any).__wrapped).toBeTruthy();
      expect((https.request as any).__wrapped).toBeTruthy();

      expect(log.mock.calls[0][2]).toEqual(log.mock.calls[1][2]); // requestId
      expect(log.mock.calls[0][3]).toEqual(log.mock.calls[1][3]); // request
      assertRequestListener();
      assertResponseListener();

      function assertRequestListener() {
        const [message, timing, requestId, request] = log.mock.calls[0];
        expect(message).toEqual('🔵 GET https://chao.yang.so/');
        expect(timing.socket).toEqual({});
        expect(timing.request.initiated).toBeGreaterThan(0);
        expect(timing.request.write).toBeGreaterThanOrEqual(
          timing.request.initiated,
        );
        expect(timing.request.end).toBeGreaterThanOrEqual(timing.request.write);
        expect(requestId.length).toEqual(36);
        expect(request).toMatchObject({
          url: 'https://chao.yang.so/',
          method: 'GET',
          headers: {
            accept: 'application/json, text/plain, */*',
            'user-agent': 'no-name',
            host: 'chao.yang.so',
          },
          body: '<0 bytes binary>',
        });
      }

      function assertResponseListener(...args) {
        const [
          message,
          timing,
          requestId,
          request,
          response,
        ] = log.mock.calls[1];
        expect(message).toEqual('🟢 200 GET https://chao.yang.so/');
        expect(timing.socket.lookup).toBeFalsy();
        expect(timing.socket.connect).toBeFalsy();
        expect(timing.socket.tls).toBeFalsy();
        expect(timing.request.initiated).toBeGreaterThan(0);
        expect(timing.request.write).toBeGreaterThanOrEqual(
          timing.request.initiated,
        );
        expect(timing.request.end).toBeGreaterThanOrEqual(timing.request.write);
        expect(timing.response.read).toBeGreaterThan(0);
        expect(timing.response.end).toBeGreaterThanOrEqual(
          timing.response.read,
        );
        expect(requestId.length).toEqual(36);
        expect(request).toMatchObject({
          url: 'https://chao.yang.so/',
          method: 'GET',
          headers: {
            accept: 'application/json, text/plain, */*',
            'user-agent': 'no-name',
            host: 'chao.yang.so',
          },
          body: '<0 bytes binary>',
        });
        expect(response).toMatchObject({
          statusCode: 200,
          statusMessage: 'OK',
          headers: {
            'content-type': 'text/plain',
            server: 'http-interceptor/stub',
          },
        });
        expect(response.body.length).toBeGreaterThan(0);
      }
    });
  });

  describe('nock compatibility', () => {
    let httpInterceptor: HttpInterceptor;

    beforeEach(() => {
      httpInterceptor = new HttpInterceptor();
      httpInterceptor.on('request.initiated', onRequestInitiated);
      httpInterceptor.on('request.sent', onRequestSent);
      httpInterceptor.on('response.received', onResponseReceived);
      httpInterceptor.on('response.error', onResponseError);
      httpInterceptor.enable();
    });

    afterEach(() => {
      httpInterceptor.disable();
      jest.clearAllMocks();
    });

    it('should work with nock', async () => {
      nock('https://chao.yang.so').get('/test').reply(200, 'works')

      const response = await axios.get('https://chao.yang.so/test')
      expect(response.data).toEqual('works')
      expect(log).toHaveBeenCalledTimes(2)
    })

  })
});


//////////////////////// HOOKS FOR TESTS ///////////////////////
/**
 * when ClientRequest is created, you have the chance to mutate its config before it is actually sent.
 * @param request
 * @param context
 */
function onRequestInitiated(request: ClientRequest, context: RequestContext) {
  // update user-agent
  request.setHeader('user-agent', 'no-name');
}

/**
 * when ClientRequest is actually sent, request is readonly.
 * @param request
 * @param context
 */
function onRequestSent(request: Request, context: RequestContext) {
  const { url, method } = request;
  log(
    `🔵 ${method} ${url}`,
    cloneDeep(context.timing),
    context.requestId,
    filteredRequest(request),
  );
}

/**
 * when an IncomingMessage response is received, response is readonly.
 * @param request
 * @param response
 * @param context
 */
function onResponseReceived(
  request: Request,
  response: Response,
  context: RequestContext,
) {
  const { statusCode } = response;
  const { url, method } = request;
  const { requestId, timing } = context;
  const indicator = statusCode < 400 ? '🟢' : '🟡';
  log(
    `${indicator} ${statusCode} ${method} ${url}`,
    cloneDeep(timing),
    requestId,
    filteredRequest(request),
    filteredResponse(response),
  );
}

/**
 * when error occurred in getting the response, but request is sent.
 * @param error
 */
function onResponseError(request: Request, error: Error, context: RequestContext) {
  warn('🔴 error', error, request);
}

function onSocketError(request: Request, error: Error, context: RequestContext) {
  warn('🔴 error', error, request);
}

function filteredRequest(request: Request) {
  const { url, method, headers, body } = request;
  return {
    url,
    method,
    headers: filteredHeaders(headers),
    body: body === false ? '<unread>' : filteredBody(body, headers),
  };
}

function filteredResponse(response: Response) {
  const { statusCode, statusMessage, headers, body } = response;
  return {
    statusCode,
    statusMessage: statusMessage,
    headers: filteredHeaders(headers),
    body: body === false ? '<unread>' : filteredBody(body, headers),
  };
}

function filteredHeaders(headers: Headers) {
  return transform(
    headers,
    (result, value, name) => {
      result[name] =
        name.toLowerCase() === 'authorization'
          ? obfuscate(value as string, 10, 3)
          : value;
    },
    {},
  );
}

function filteredBody(body: Buffer, headers: Headers) {
  if (!body) return body;
  const binary = `<${body.length} bytes binary>`;
  if (!headers['content-type']) {
    return binary;
  }
  const mediaType = mime.parse(headers['content-type']);
  const normalisedMediaType = mediaType.type;
  const textualMimeTypes = [
    'text/plain',
    'text/html',
    'application/json',
    'application/csv',
    'application/x-www-form-urlencoded',
  ];
  if (!textualMimeTypes.includes(normalisedMediaType)) {
    return binary;
  }

  return normalisedMediaType === 'application/json'
    ? body.toString()
    : truncate(body.toString(), {
        length: 500,
      });
}

function obfuscate(
  str: string,
  reservePrefix: number,
  reserveSuffix: number,
  replaceChar = '*',
): string {
  if (str.length <= reservePrefix + reserveSuffix) {
    return str;
  }
  const middlePiece = str.substr(
    reservePrefix,
    str.length - reservePrefix - reserveSuffix,
  );
  return str.replace(middlePiece, middlePiece.replace(/./g, replaceChar));
}
