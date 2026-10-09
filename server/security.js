// Beveiligingsheaders voor elke HTTP-response.
// Strikte Content-Security-Policy: alleen eigen scripts en stijlen, geen externe bronnen.

export function securityHeaders(config) {
  const wsOrigin = config.origin.replace(/^http/, 'ws');
  const headers = {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "media-src 'self' blob: mediastream:",
      `connect-src 'self' ${wsOrigin}`,
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()',
  };
  if (config.secureCookies) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      // Laatste adres is wat de eigen reverse proxy heeft toegevoegd.
      const parts = forwarded.split(',').map((s) => s.trim());
      return parts[parts.length - 1];
    }
  }
  return req.socket.remoteAddress || 'onbekend';
}

export function sameOrigin(req, config) {
  const origin = req.headers.origin;
  return typeof origin === 'string' && origin === config.origin;
}
