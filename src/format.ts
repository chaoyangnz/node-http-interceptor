import { Request, RequestContext, Response, Headers } from './http-interceptor'
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { transform, isArray, repeat } from 'lodash';
import * as mime from 'content-type';
import { prettyPrint } from 'multipart-form-data-parser';

export interface FormatConfig {
  redactedHeaders: string[],
  binaryLogMaxSize: number
}

const wellKnownTextualContentTypes = [
  'text/plain',
  'text/html',
  'text/xml',
  'application/json',
  'application/x-amz-json-1.0',
  'application/x-amz-json-1.1',
  'application/csv',
  'application/x-www-form-urlencoded',
];

const defaultFormatConfig: FormatConfig = {
  redactedHeaders: ['authorization', 'authentication', 'cookie', 'set-cookie'],
  binaryLogMaxSize: 1024
}

export const formatRequest = (request: Request, context: RequestContext, config: FormatConfig = defaultFormatConfig) => {
  const {url, method} = request
  return [
    `🔵 ${method} ${url}`,
    context.requestId,
    filteredRequest(request, config)
  ]
}

export const formatResponse = (request: Request, response: Response, context: RequestContext, config: FormatConfig = defaultFormatConfig) => {
  const { statusCode } = response;
  const { url, method } = request;
  const { requestId, timing } = context;
  const indicator = statusCode < 400 ? '🟢' : '🟡';
  const elapsed = timing.response.end && timing.request.initiated ? (timing.response.end - timing.request.initiated) : '-';
  const ret = [
    `${indicator} ${statusCode} ${method} ${url} (${elapsed} ms)`,
    requestId,
    filteredResponse(response, config),
    filteredRequest(request, config),
  ]
  return ret
}

export const formatError = (request: Request, error: Error, context: RequestContext) => {
  const { url, method } = request;
  const { requestId } = context;
  return [`🔴 ${method} ${url} error`, requestId, error]
}


function filteredRequest(request: Request, config: FormatConfig) {
  const { url, method, headers, body } = request;
  const bodyLength = request.headers['content-length'];
  const neverPeekedBody = bodyLength
    ? `<${bodyLength} octets never peeked>`
    : '<never peeked>';
  return {
    url,
    method,
    headers: transformHeaders(
      headers,
      config.redactedHeaders
    ),
    body:
      body === false
        ? neverPeekedBody
        : transformBody(
          body,
          headers,
          config.binaryLogMaxSize
        ),
  };
}

function filteredResponse(response: Response, config: FormatConfig) {
  const { statusCode, statusMessage, headers, body } = response;
  const bodyLength = response.headers['content-length'];
  const neverPeekedBody = bodyLength
    ? `<${bodyLength} octets never peeked>`
    : '<never peeked>';
  return {
    statusCode,
    statusMessage,
    headers: transformHeaders(
      headers,
      config.redactedHeaders
    ),
    body:
      body === false
        ? neverPeekedBody
        : transformBody(
          body,
          headers,
          config.binaryLogMaxSize
        ),
  };
}

function transformHeaders(headers: Headers, redactHeaders: string[]) {
  return transform(
    headers,
    (result: any, value, name) => {
      result[name] = redactHeaders.includes(name.toLowerCase())
        ? (typeof value === 'string' ? [value] : value).map((val) =>
          obfuscate(val, 10, 3)
        )
        : value;
    },
    {}
  );
}

function transformBody(
  body: Buffer | undefined,
  headers: Headers,
  binaryLogMaxSize: number
) {
  if (!body) return body;
  if (body.length === 0) return '';

  const contentTypeHeader = headers['content-type'];

  const mediaType = mime.parse(
    isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
  );
  const normalisedMediaType = mediaType.type;

  const encoding = headers['content-encoding'];
  if (encoding === 'gzip') {
    body = zlib.gunzipSync(body);
  }

  // special handling for multipart/form-data, as we think it is a semi-textual content type.
  if (normalisedMediaType === 'multipart/form-data') {
    return prettyPrint(
      body,
      mediaType.parameters?.boundary,
      wellKnownTextualContentTypes,
      binaryLogMaxSize
    );
  }

  return transformBodyByContentType(body, normalisedMediaType, binaryLogMaxSize);
}

function transformBodyByContentType(
  body: Buffer,
  contentType: string,
  binaryLogMaxSize: number
) {
  if (!body) return body;
  return wellKnownTextualContentTypes.includes(contentType)
    ? body.toString('utf8')
    : body.length >= binaryLogMaxSize
      ? `<${body.length} octets>: sha256 ${crypto
        .createHash('sha256')
        .update(body)
        .digest('hex')}`
      : body.toString('base64');
}

function obfuscate(
  str: string,
  reservePrefix: number,
  reserveSuffix: number,
  replaceChar = '*'
): string {
  if (!str) {
    return '';
  }
  if (str.length <= reservePrefix + reserveSuffix) {
    return str;
  }
  const middlePiece = str.substr(
    reservePrefix,
    str.length - reservePrefix - reserveSuffix
  );
  return str.replace(middlePiece, repeat(replaceChar, 5));
}
