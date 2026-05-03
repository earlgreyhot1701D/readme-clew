import { Router } from 'express';
import { getCached } from '../scan-cache.js';

const router = Router();

// Rate limiter — same pattern and limit as badge (300/hr/IP)
const ogRateLimit = new Map<string, { count: number; resetAt: number }>();
const OG_LIMIT = 300;
const OG_WINDOW_MS = 3_600_000;

function checkOgRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ogRateLimit.get(ip);
  if (!entry || entry.resetAt < now) {
    ogRateLimit.set(ip, { count: 1, resetAt: now + OG_WINDOW_MS });
    return true;
  }
  if (entry.count >= OG_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of ogRateLimit) {
      if (entry.resetAt < now) ogRateLimit.delete(ip);
    }
  },
  10 * 60 * 1000,
);

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

router.get('/og', (req, res) => {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.ip ?? 'unknown';

  if (!checkOgRateLimit(ip)) {
    res.status(429).send('rate limited');
    return;
  }

  const owner = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
  const repo  = typeof req.query.repo  === 'string' ? req.query.repo.trim()  : '';

  if (!owner || !repo) {
    res.status(400).send('missing owner or repo');
    return;
  }

  const proto  = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const origin = proto + '://' + (req.get('host') ?? '');
  const appUrl = origin + '/?repo=https://github.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
  const imgUrl = origin + '/cover-artwork.jpg';

  const cached = getCached(owner, repo);

  let title: string;
  let description: string;

  if (cached) {
    const v = cached.verified.length;
    const u = cached.unverifiable.length;
    const m = cached.missing.length;
    const c = cached.contradicted.length;
    title = owner + '/' + repo + ' — ' + v + ' verified, ' + u + ' unverifiable, ' + m + ' missing, ' + c + ' contradicted';
    description = cached.notes?.read ?? ('readme clew audited ' + (v + u + m + c) + ' claims from the ' + owner + '/' + repo + ' README.');
  } else {
    title = 'readme clew — ' + owner + '/' + repo;
    description = 'Verifying README claims for ' + owner + '/' + repo + ' against the actual source code. Findings only. Nothing saved.';
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(appUrl)}" />
  <meta property="og:image" content="${esc(imgUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(imgUrl)}" />
  <meta http-equiv="refresh" content="0;url=${esc(appUrl)}" />
</head>
<body>
  <a href="${esc(appUrl)}">readme clew — ${esc(owner)}/${esc(repo)}</a>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(html);
});

export default router;
