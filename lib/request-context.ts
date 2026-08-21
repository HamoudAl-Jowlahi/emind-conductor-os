/**
 * Who is asking, from where — for the audit trail and the rate limiter.
 *
 * Behind a proxy the socket address is the proxy's, so the client address
 * arrives in a header. Headers are attacker-controlled, so this only trusts
 * them when TRUST_PROXY is set: on a directly-exposed server, believing
 * x-forwarded-for would let anyone forge a fresh address per request and walk
 * straight through the rate limiter.
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers.get('x-forwarded-for');
    // Left-most entry is the original client; the rest are proxies.
    if (forwarded) return forwarded.split(',')[0].trim();
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}

export function userAgent(req: Request): string {
  return req.headers.get('user-agent') ?? 'unknown';
}
