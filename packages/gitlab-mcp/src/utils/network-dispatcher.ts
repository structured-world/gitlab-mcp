import * as fs from 'fs';
import { GITLAB_CA_CERT_PATH, HTTP_PROXY, HTTPS_PROXY, NO_PROXY } from '../config';
import { logInfo, logWarn } from '../logger';

const undici = require('undici') as {
  Agent: new (options: Record<string, unknown>) => unknown;
  Pool: new (origin: string, options: Record<string, unknown>) => unknown;
  EnvHttpProxyAgent: new (options: Record<string, unknown>) => unknown;
};

interface NetworkOptions {
  origin?: string;
  insecureSkipVerify?: boolean;
  connectTimeout: number;
  headersTimeout: number;
  bodyTimeout: number;
  connections?: number;
  keepAliveTimeout?: number;
  keepAliveMaxTimeout?: number;
  pipelining?: number;
}

let certificateLoaded = false;
let certificate: Buffer | undefined;

/** Load immutable process-level trust configuration once, before creating dispatchers. */
function loadCertificate(): Buffer | undefined {
  if (certificateLoaded) return certificate;
  certificateLoaded = true;
  if (!GITLAB_CA_CERT_PATH) return undefined;
  try {
    certificate = fs.readFileSync(GITLAB_CA_CERT_PATH);
    logInfo(`Custom CA certificate loaded from ${GITLAB_CA_CERT_PATH}`);
  } catch (error: unknown) {
    logWarn(`Failed to load CA certificate from ${GITLAB_CA_CERT_PATH}`, { err: error });
  }
  return certificate;
}

/** Remove proxy userinfo from diagnostics without altering connection configuration. */
function proxyUrlForLogging(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return '<invalid proxy URL>';
    if (!parsed.username && !parsed.password) return value;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return '<invalid proxy URL>';
  }
}

/** Share proxy routing, GitLab trust and timeouts between startup and instance transports. */
export function createNetworkDispatcher({
  origin,
  insecureSkipVerify,
  connectTimeout,
  ...options
}: NetworkOptions): unknown {
  const ca = loadCertificate();
  const connect = {
    ...(insecureSkipVerify ? { rejectUnauthorized: false } : {}),
    ...(ca ? { ca } : {}),
    timeout: connectTimeout,
    keepAlive: true,
    keepAliveInitialDelay: 30000,
  };
  const proxyUrl = (HTTPS_PROXY === '' ? undefined : HTTPS_PROXY) ?? HTTP_PROXY;
  if (proxyUrl && /^(socks4?|socks5):\/\//.test(proxyUrl)) {
    logInfo(`Using SOCKS proxy: ${proxyUrlForLogging(proxyUrl)}`);
    logWarn('SOCKS proxy not supported with native fetch. Consider HTTP/HTTPS proxy.');
    // SOCKS is unavailable; registered origins retain their direct connection pools.
    if (!origin) return undefined;
  } else if (proxyUrl) {
    logInfo(`Using proxy: ${proxyUrlForLogging(proxyUrl)}`);
    // Undici's HTTP forwarding and CONNECT-client factories receive only connect options.
    // Carry pool limits and response timeouts into those pools as well as target pools.
    const factory = (poolOrigin: string | URL, poolOptions: Record<string, unknown>) =>
      new undici.Pool(String(poolOrigin), { ...options, ...poolOptions });
    return new undici.EnvHttpProxyAgent({
      ...options,
      httpProxy: HTTP_PROXY,
      httpsProxy: HTTPS_PROXY,
      noProxy: NO_PROXY,
      factory,
      clientFactory: factory,
      connect,
      requestTls: connect,
      // Instance TLS overrides apply to GitLab, not the separate proxy trust boundary.
      proxyTls: { timeout: connectTimeout },
    });
  }
  const directOptions = { ...options, connect };
  return origin ? new undici.Pool(origin, directOptions) : new undici.Agent(directOptions);
}
