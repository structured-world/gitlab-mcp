/**
 * Longest time one OAuth request to GitLab can take under the configured request timeouts:
 * two connects (through a proxy the second is the TLS handshake to GitLab), the response
 * headers and the response body. A reservation that must outlast a GitLab request it
 * guards (single-use device codes, single-use refresh tokens) lasts at least this long.
 */

import { BODY_TIMEOUT_MS, CONNECT_TIMEOUT_MS, HEADERS_TIMEOUT_MS } from '../config';

export const GITLAB_REQUEST_MAX_MS = 2 * CONNECT_TIMEOUT_MS + HEADERS_TIMEOUT_MS + BODY_TIMEOUT_MS;
