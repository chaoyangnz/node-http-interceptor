import {
  HttpInterceptor,
  RequestContext,
  Response,
  Request,
  Headers,
} from './http-interceptor';
import { transform } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import * as mime from 'media-typer';
import { ClientRequest } from 'http';
import axios from 'axios';

/**
 * when ClientRequest is created, you have the chance to mutate its config before it is actually sent.
 * @param request
 * @param context
 */
function onRequestInitiated(request: ClientRequest, context: RequestContext) {
  // initial additional request meta
  context.requestId = uuidv4();
  context.requestStartedAt = new Date().getTime();
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
  console.info(
    `🔵 ${method} ${url}`,
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
  const { requestId, requestStartedAt } = context;
  const timing = new Date().getTime() - requestStartedAt;
  const indicator = statusCode < 400 ? '🟢' : '🟡';
  console.info(
    `${indicator} ${statusCode} ${method} ${url} (${timing} ms)`,
    requestId,
    filteredRequest(request),
    filteredResponse(response),
  );
}

/**
 * when error occurred in getting the response, but request is sent.
 * @param error
 */
function onError(error: any) {
  console.warn('🔴 error', error);
}

describe('HttpInterceptor', () => {
  beforeAll(() => {
    const httpInterceptor = new HttpInterceptor();
    httpInterceptor.on('request.initiated', onRequestInitiated);
    httpInterceptor.on('request.sent', onRequestSent);
    httpInterceptor.on('response.received', onResponseReceived);
    httpInterceptor.on('response.error', onError);
  });

  it('should', async () => {
    await axios.get('https://google.com');
  });
});

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
  const normalisedMediaType = `${mediaType.type}/${mediaType.subtype}`;
  const textualMimeTypes = [
    'text/plain',
    'text/html',
    'application/json',
    'application/csv',
    'application/x-www-form-urlencoded',
  ];

  return !textualMimeTypes.includes(normalisedMediaType)
    ? binary
    : body.toString();
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
