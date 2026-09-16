import { EnvHttpProxyAgent } from 'undici';

let dispatcher: EnvHttpProxyAgent | undefined;

/** Only provider requests use the configured proxy. Local API traffic is untouched. */
export const providerFetch: typeof fetch = (input, init) => {
  const hasProxy = process.env.https_proxy || process.env.HTTPS_PROXY
    || process.env.http_proxy || process.env.HTTP_PROXY;
  if (!hasProxy) return fetch(input, init);
  dispatcher ??= new EnvHttpProxyAgent();
  const options: RequestInit & { dispatcher: EnvHttpProxyAgent } = { ...init, dispatcher };
  return fetch(input, options);
};
