import { Router } from 'express';
import { parseGitHubUrl } from '../validate.js';
import { fetchReadme, fetchPackageJson, fetchFileTree, fetchSourceFiles, fetchSubPackageJsons } from '../github.js';
import { extractClaims } from '../extract.js';
import { runScan } from '../orchestrator.js';
import { generateScanNotes } from '../summarize.js';
import { setCached } from '../scan-cache.js';
import type { RepoData } from '../verifiers/types.js';

// STUB: Private repo support (post-buildathon)
// When implemented: GitHub OAuth flow + token-scoped repo access
// See: PRD section 11

// STUB: Save scan history (out of scope — stateless by design)
// NEVER implemented — stateless is a feature

const router = Router();

const SCAN_TIMEOUT_MS = 60_000;

// Simple in-memory rate limiter: 10 scans per hour per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Clean up stale rate limit entries every 10 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
      if (entry.resetAt < now) rateLimitMap.delete(ip);
    }
  },
  10 * 60 * 1000,
);

async function performScan(owner: string, repo: string): Promise<ReturnType<typeof runScan>> {
  // Phase 1: fetch repo data in parallel
  const [readmeText, packageJson, fileTree] = await Promise.all([
    fetchReadme(owner, repo),
    fetchPackageJson(owner, repo),
    fetchFileTree(owner, repo),
  ]);

  // Phase 2: fetch source files, subpackage JSONs, and extract claims in parallel
  const [sourceFiles, subPackageJsons, extraction] = await Promise.all([
    fetchSourceFiles(owner, repo, fileTree),
    fetchSubPackageJsons(owner, repo, fileTree),
    extractClaims(readmeText),
  ]);

  const data: RepoData = { owner, repo, readmeText, packageJson, subPackageJsons, fileTree, sourceFiles };
  const result = await runScan(data, extraction.claims, extraction.error, extraction.truncated);
  const notes = await generateScanNotes(result);
  if (notes !== null) result.notes = notes;
  return result;
}

router.post('/scan', async (req, res) => {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.ip ?? 'unknown';

  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'rate limit reached. max 10 scans per hour per IP.' });
    return;
  }

  const { repoUrl } = req.body as { repoUrl?: string };

  if (!repoUrl || typeof repoUrl !== 'string' || repoUrl.trim() === '') {
    res.status(400).json({ error: 'missing repoUrl in request body' });
    return;
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseGitHubUrl(repoUrl));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid url';
    res.status(400).json({ error: message });
    return;
  }

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('scan timed out after 60 seconds')), SCAN_TIMEOUT_MS),
    );

    const result = await Promise.race([performScan(owner, repo), timeout]);
    setCached(owner, repo, result);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'scan failed';
    req.log.error({ err: message }, 'scan error');

    // Surface meaningful errors to the client — not just generic 500
    if (
      message.includes('readme not found') ||
      message.includes('rate limit') ||
      message.includes('timed out') ||
      message.includes('not found')
    ) {
      res.status(422).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
