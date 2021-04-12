import {
  HttpInterceptor,
  RequestContext,
  Response,
  Request,
  Headers,
} from './http-interceptor';
import { transform, truncate, cloneDeep } from 'lodash';
import * as mime from 'content-type';
import { ClientRequest } from 'http';
import axios from 'axios';
import * as http from 'http';
import * as https from 'https';

const log = jest.fn().mockImplementation((...args) => {
  console.info(args);
});

describe('HttpInterceptor', () => {
  let httpInterceptor: HttpInterceptor;
  beforeEach(() => {
    httpInterceptor = new HttpInterceptor();
    httpInterceptor.on('request.initiated', onRequestInitiated);
    httpInterceptor.on('request.sent', onRequestSent);
    httpInterceptor.on('response.received', onResponseReceived);
    httpInterceptor.on('response.error', onResponseError);
  });

  afterEach(() => {
    httpInterceptor.disable();
    jest.clearAllMocks();
  });

  it('should wrap http.request', async () => {
    const res = await axios.get<string>('https://chao.yang.to');
    expect(res.data).toBeTruthy();
    expect((http.request as any).__wrapped).toBeTruthy();
    expect((https.request as any).__wrapped).toBeTruthy();

    expect(log.mock.calls[0][2]).toEqual(log.mock.calls[1][2]); // requestId
    expect(log.mock.calls[0][3]).toEqual(log.mock.calls[1][3]); // request
    assertRequestListener();
    assertResponseListener();

    function assertRequestListener() {
      const [message, timing, requestId, request] = log.mock.calls[0];
      expect(message).toEqual('🔵 GET https://chao.yang.to/');
      expect(timing.socket).toEqual({});
      expect(timing.request.initiated).toBeGreaterThan(0);
      expect(timing.request.write).toBeGreaterThanOrEqual(
        timing.request.initiated,
      );
      expect(timing.request.end).toBeGreaterThanOrEqual(timing.request.write);
      expect(requestId.length).toEqual(36);
      expect(request).toMatchObject({
        url: 'https://chao.yang.to/',
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, */*',
          'user-agent': 'no-name',
          host: 'chao.yang.to',
        },
        body: '<0 bytes binary>',
      });
    }

    function assertResponseListener(...args) {
      const [message, timing, requestId, request, response] = log.mock.calls[1];
      expect(message).toEqual('🟢 200 GET https://chao.yang.to/');
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
        url: 'https://chao.yang.to/',
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, */*',
          'user-agent': 'no-name',
          host: 'chao.yang.to',
        },
        body: '<0 bytes binary>',
      });
      expect(response).toMatchObject({
        statusCode: 200,
        statusText: 'OK',
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
    const response = await axios.get<string>('https://chao.yang.to');
    expect(response.data).toBeTruthy();
    expect((http.request as any).__wrapped).toBeFalsy();
    expect((https.request as any).__wrapped).toBeFalsy();
    expect(log).not.toHaveBeenCalled();
  });
});

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
function onResponseError(error: Error) {
  console.warn('🔴 error', error);
}

function filteredRequest(request: Request) {
  const { url, method, headers, body } = request;
  return {
    url,
    method,
    headers: filteredHeaders(headers),
    body: filteredBody(body, headers),
  };
}

function filteredResponse(response: Response) {
  const { statusCode, statusText, headers, body } = response;
  return {
    statusCode,
    statusText,
    headers: filteredHeaders(headers),
    body: filteredBody(body, headers),
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
