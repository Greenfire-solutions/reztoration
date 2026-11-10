// A per-visitor limit on API requests, so one script cannot hold the map hostage for everyone else.
// A fixed window per minute is enough here: search-as-you-type sends a few requests a second at most.
export class RateLimit {
  constructor(perMinute, now = () => Date.now()) {
    this.perMinute = perMinute;
    this.now = now;
    this.hits = new Map(); // ip -> { window, count }
  }

  // true when this request may go ahead
  allow(ip) {
    if (!this.perMinute) return true;
    const window = Math.floor(this.now() / 60000);
    const h = this.hits.get(ip);
    if (!h || h.window !== window) {
      if (this.hits.size > 50000) this.sweep(window);
      this.hits.set(ip, { window, count: 1 });
      return true;
    }
    return ++h.count <= this.perMinute;
  }

  sweep(window) {
    for (const [ip, h] of this.hits) if (h.window !== window) this.hits.delete(ip);
  }
}

// Behind Caddy on the same machine every request arrives from 127.0.0.1, and Caddy puts the real
// visitor's address last in X-Forwarded-For. Only that case is trusted; anything else uses the socket.
export function visitorIp(req, behindProxy) {
  const sock = req.socket.remoteAddress || '';
  const local = sock === '127.0.0.1' || sock === '::1' || sock === '::ffff:127.0.0.1';
  if (behindProxy && local) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return sock;
}
