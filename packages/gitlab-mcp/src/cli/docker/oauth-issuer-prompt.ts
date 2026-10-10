/**
 * Prompt for the public URL of an OAuth deployment (OAUTH_ISSUER)
 */

import * as p from '@clack/prompts';
import { issuerValidationError } from '../../oauth/config';

/**
 * Ask for the URL clients connect to. It is the issuer of every token and the base of the
 * GitLab callback, so a remote deployment needs its real URL; the default only serves
 * clients on this machine. Values the server would reject are refused here.
 */
export function promptOAuthIssuer(port: number): ReturnType<typeof p.text> {
  return p.text({
    message: 'Public URL clients connect to (OAUTH_ISSUER):',
    placeholder: 'https://mcp.example.com',
    initialValue: `http://localhost:${port}`,
    validate: (value) => issuerValidationError(value ?? ''),
  });
}
