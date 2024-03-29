[![Sponsor][sponsor-badge]][sponsor]
[![NPM version][npm-badge]][npm]
[![TypeScript version][ts-badge]][typescript-4-2]
[![Node.js version][nodejs-badge]][nodejs]
[![Build Status - GitHub Actions][gha-badge]][gha-ci]

# node-http-interceptor

⚡ Intercept the low-level http requests, which is helpful when you need to do logging, monitoring or instrumentation etc.

## Features

- transparent to the normal http flow without inference
  - all errors in the interceptor are silently suppressed, only logged but not thrown
  - never consume the original stream (`ClientRequest` or `IncomingMessage`) when downstream consumer is not going to read or write
- capability of enabling or disabling the interception
- `RequestContext` is a request scope container to hold any data during the request-response round-trip, which is like the concept of `HttpServletRequest.getAttributes()` in Java.
- generate a requestId and request timings by default in `RequestContext`

### Timings
![timings](timings.png)

## Usage

### nodejs preload modules

```
npm i -g node-http-interceptor
ln -vs "$(npm root -g)" "$HOME"/.node_modules
```

```shell
node -r node-http-interceptor/register
```

### hooks

```typescript
import { HttpInterceptor, RequestContext } from './http-interceptor';

const interceptor = new HttpInterceptor();
interceptor.on('request.initiated', (request: ClientRequest, context: RequestContext) => {
  // do somethong to mutate request
})

interceptor.on('request.sent', (request: Request, context: RequestContext) => {
  // log the request
})

interceptor.on('response.received', (request: Request, response: Response, context: RequestContext) => {
  // log the response
})

interceptor.on('response.error', (request: Request, error: any, context: RequestContext) => {
  // log the error
})

interceptor.on('socket.error', (request: Request, error: any, context: RequestContext) => {
  // log the error
})
interceptor.enable()
```

### stubbing

```typescript
const interceptor = new HttpInterceptor();

interceptor.stub((req: Request) => ({
  statusCode: 200,
  statusMessage: 'OK',
  headers: {
    'content-type': 'text/plain',
    'x-custom-header': 'blabla'
  },
  body: Buffer.from('test')
}));

interceptor.on('response.received', (response: Response, context: RequestContext) => {
  expect(response.body.toString()).toEqual('test')
})
interceptor.enabled();

// later on
interceptor.unstub()
```



[ts-badge]: https://img.shields.io/badge/TypeScript-4.2-blue.svg
[nodejs-badge]: https://img.shields.io/badge/Node.js->=%2012.20-blue.svg
[nodejs]: https://nodejs.org/dist/latest-v14.x/docs/api/
[gha-badge]: https://github.com/chaoyangnz/node-http-interceptor/workflows/build/badge.svg
[gha-ci]: https://github.com/chaoyangnz/node-http-interceptor/actions
[typescript]: https://www.typescriptlang.org/
[typescript-4-2]: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-2.html
[license-badge]: https://img.shields.io/badge/license-MIT-blue.svg
[license]: https://github.com/chaoyangnz/node-http-interceptor/blob/master/LICENSE
[sponsor-badge]: https://img.shields.io/badge/♥-Sponsor-fc0fb5.svg
[sponsor]: https://github.com/sponsors/chaoyangnz
[jest]: https://facebook.github.io/jest/
[eslint]: https://github.com/eslint/eslint
[prettier]: https://prettier.io
[volta]: https://volta.sh
[volta-getting-started]: https://docs.volta.sh/guide/getting-started
[volta-tomdale]: https://twitter.com/tomdale/status/1162017336699838467?s=20
[gh-actions]: https://github.com/features/actions
[travis]: https://travis-ci.org
[repo-template-action]: https://github.com/chaoyangnz/node-http-interceptor/generate
[npm-badge]: https://img.shields.io/npm/v/node-http-interceptor
[npm]: https://www.npmjs.com/package/node-http-interceptor
