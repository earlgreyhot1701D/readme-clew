import { Router } from 'express';
import { getCached } from '../scan-cache.js';

const router = Router();

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

router.get('/badge/:owner/:repo', (req, res) => {
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
