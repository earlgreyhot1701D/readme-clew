import { Router } from 'express';
import { getCached } from '../scan-cache.js';

const router = Router();

// Rate limiter — generous for embedded badge use (page views), but not unbounded
const badgeRateLimit = new Map<string, { count: number; resetAt: number }>();
const BADGE_LIMIT = 300;
const BADGE_WINDOW_MS = 3_600_000;

function checkBadgeRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = badgeRateLimit.get(ip);
  if (!entry || entry.resetAt < now) {
    badgeRateLimit.set(ip, { count: 1, resetAt: now + BADGE_WINDOW_MS });
    return true;
  }
  if (entry.count >= BADGE_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of badgeRateLimit) {
      if (entry.resetAt < now) badgeRateLimit.delete(ip);
    }
  },
  10 * 60 * 1000,
);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeBadge(v: number, u: number, m: number, c: number): string {
  const right = `\u25cf ${v}  \u25cb ${u}  \u25b2 ${m}  \u2715 ${c}`;
  const rightW = Math.max(130, Math.ceil(right.length * 7) + 16);
  const totalW = 92 + rightW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${esc('readme clew: ' + right)}">
  <title>${esc('readme clew: ' + right)}</title>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="92" height="20" fill="#1A3380"/>
    <rect x="92" width="${rightW}" height="20" fill="#EDE8D5"/>
    <rect x="91" width="2" height="20" fill="#B8872C"/>
  </g>
  <text x="46" y="14" fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" font-weight="600">${esc('readme clew')}</text>
  <text x="100" y="14" fill="#18180F" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">${esc(right)}</text>
</svg>`;
}

function makeUnscanBadge(): string {
  const right = 'not yet scanned';
  const rightW = Math.ceil(right.length * 7) + 16;
  const totalW = 92 + rightW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="readme clew: not yet scanned">
  <title>readme clew: not yet scanned</title>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="92" height="20" fill="#1A3380"/>
    <rect x="92" width="${rightW}" height="20" fill="#EDE8D5"/>
    <rect x="91" width="2" height="20" fill="#B8872C"/>
  </g>
  <text x="46" y="14" fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" font-weight="600">${esc('readme clew')}</text>
  <text x="100" y="14" fill="#888" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" font-style="italic">${esc(right)}</text>
</svg>`;
}

function makeRateLimitedBadge(): string {
  const right = 'rate limited';
  const rightW = Math.ceil(right.length * 7) + 16;
  const totalW = 92 + rightW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="readme clew: rate limited">
  <title>readme clew: rate limited</title>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="92" height="20" fill="#1A3380"/>
    <rect x="92" width="${rightW}" height="20" fill="#EDE8D5"/>
    <rect x="91" width="2" height="20" fill="#B8872C"/>
  </g>
  <text x="46" y="14" fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" font-weight="600">${esc('readme clew')}</text>
  <text x="100" y="14" fill="#888" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" font-style="italic">${esc(right)}</text>
</svg>`;
}

router.get('/badge/:owner/:repo', (req, res) => {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.ip ?? 'unknown';

  if (!checkBadgeRateLimit(ip)) {
    res.status(429);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(makeRateLimitedBadge());
    return;
  }

  const owner = req.params.owner;
  const repo  = req.params.repo;
  const cached = getCached(owner, repo);
  const svg = cached
    ? makeBadge(cached.verified.length, cached.unverifiable.length, cached.missing.length, cached.contradicted.length)
    : makeUnscanBadge();
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(svg);
});

export default router;
