import crypto from 'crypto';

// Comma-separated shared API tokens. They deliberately live only in the
// deployment environment: publishing a token in the client bundle would make
// it public again. A token can be generated with `openssl rand -hex 32`.
const configuredTokens = () => new Set(
  (process.env.API_TOKENS || '')
    .split(',')
    .map(entry => {
      const value = entry.trim();
      // A deployment can retain a non-secret ownership label as
      // `label:token` (for example `alice:abc...,partner:def...`). Plain
      // tokens remain valid for backwards compatibility, including dev.
      const separator = value.indexOf(':');
      return separator === -1 ? value : value.slice(separator + 1).trim();
    })
    .filter(Boolean),
);

export function requireApiToken(req, res, next) {
  const bearerMatch = req.headers.authorization?.match(/^Bearer (.+)$/i);
  const token = req.headers['x-api-token'] || bearerMatch?.[1];
  const tokens = configuredTokens();

  // An unset API_TOKENS must never accidentally expose the protected API.
  if (!token || tokens.size === 0 || ![...tokens].some(candidate => (
    candidate.length === token.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(token))
  ))) {
    return res.status(401).json({ error: 'Unauthorized API token' });
  }
  next();
}
