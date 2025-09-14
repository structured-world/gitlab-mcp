import fetchCookie from 'fetch-cookie';
import * as fs from 'fs';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch, { RequestInit } from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { CookieJar, parse as parseCookie } from 'tough-cookie';
import { logger } from './logger';
import {
  GITLAB_AUTH_COOKIE_PATH,
  GITLAB_CA_CERT_PATH,
  HTTP_PROXY,
  HTTPS_PROXY,
  NODE_TLS_REJECT_UNAUTHORIZED,
  GITLAB_TOKEN,
} from './config';

// Cookie handling
const createCookieJar = (): CookieJar | null => {
  if (!GITLAB_AUTH_COOKIE_PATH) {
    return null;
  }

  try {
    const jar = new CookieJar();
    const cookieString = fs.readFileSync(GITLAB_AUTH_COOKIE_PATH, 'utf-8');

    cookieString.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        try {
          const cookie = parseCookie(trimmed);
          if (cookie) {
            jar.setCookieSync(cookie, 'https://gitlab.com');
          }
        } catch (cookieError: unknown) {
          logger.warn({ err: cookieError }, `Failed to parse cookie: ${trimmed}`);
        }
      }
    });

    return jar;
  } catch (error: unknown) {
    logger.error({ err: error }, 'Error loading cookie file');
    return null;
  }
};

const cookieJar = createCookieJar();

// Proxy agent setup
let agent: HttpProxyAgent<string> | HttpsProxyAgent<string> | SocksProxyAgent | undefined;

if (HTTP_PROXY || HTTPS_PROXY) {
  const proxyUrl = HTTPS_PROXY ?? HTTP_PROXY;
  if (!proxyUrl) {
    throw new Error('Proxy URL is undefined');
  }

  if (proxyUrl.startsWith('socks4://') || proxyUrl.startsWith('socks5://')) {
    agent = new SocksProxyAgent(proxyUrl);
  } else if (proxyUrl.startsWith('https://')) {
    agent = new HttpsProxyAgent(proxyUrl);
  } else {
    agent = new HttpProxyAgent(proxyUrl);
  }

  logger.info(`Using proxy: ${proxyUrl}`);
}

// TLS configuration
if (NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  logger.warn('TLS certificate verification disabled');
}

// CA certificate handling
let ca: Buffer | undefined;
if (GITLAB_CA_CERT_PATH) {
  try {
    ca = fs.readFileSync(GITLAB_CA_CERT_PATH);
    logger.info(`Custom CA certificate loaded from ${GITLAB_CA_CERT_PATH}`);
  } catch (error: unknown) {
    logger.error({ err: error }, `Failed to load CA certificate from ${GITLAB_CA_CERT_PATH}`);
  }
}

// HTTP headers and configuration
export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'GitLab MCP Server',
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

if (GITLAB_TOKEN) {
  DEFAULT_HEADERS.Authorization = `Bearer ${GITLAB_TOKEN}`;
}

export const DEFAULT_FETCH_CONFIG: RequestInit = {
  headers: DEFAULT_HEADERS,
  agent,
  ...(ca && { ca }),
};

// Export configured fetch function
export const fetch = cookieJar ? fetchCookie(nodeFetch, cookieJar) : nodeFetch;
