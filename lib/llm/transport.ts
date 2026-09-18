import { Agent, EnvHttpProxyAgent } from 'undici';

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

function connectTimeoutMs() {
  const configured = Number(process.env.LLM_CONNECT_TIMEOUT_MS);
  return Number.isInteger(configured) && configured >= 1_000 && configured <= 30_000
    ? configured
    : DEFAULT_CONNECT_TIMEOUT_MS;
}

let dispatcher: Agent | EnvHttpProxyAgent | undefined;

/** Provider traffic gets a bounded connection phase so an unreachable model endpoint
 * fails quickly. The overall generation timeout is still controlled by each client. */
export const providerFetch: typeof fetch = (input, init) => {
  const hasProxy = process.env.https_proxy || process.env.HTTPS_PROXY
    || process.env.http_proxy || process.env.HTTP_PROXY;
  dispatcher ??= hasProxy
    ? new EnvHttpProxyAgent({ connectTimeout: connectTimeoutMs() })
    : new Agent({ connectTimeout: connectTimeoutMs() });
  const options: RequestInit & { dispatcher: Agent | EnvHttpProxyAgent } = { ...init, dispatcher };
  return fetch(input, options);
};
