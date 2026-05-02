import type { Claim, VerifierResult, RepoData } from './types.js';

const URL_PATTERN = /^https?:\/\//i;
const EMBEDDED_URL_RE = /https?:\/\/[^\s)"'>]+/gi;

function isUrl(s: string): boolean {
  return URL_PATTERN.test(s.trim());
}

// Extract all https?:// URLs embedded anywhere in a string
// (handles prose, git clone commands, markdown image/link syntax, etc.)
function extractEmbeddedUrls(s: string): string[] {
  const raw = s.match(EMBEDDED_URL_RE) || [];
  // Strip common trailing punctuation that isn't part of the URL
  return [...new Set(raw.map((u) => u.replace(/[.,;:!?)]+$/, '')))];
}

function normalizeFilePath(ref: string): string {
  return ref.trim().replace(/^\.\//, '').replace(/^\//, '');
}

function looksLikeFilePath(s: string): boolean {
  const t = s.trim();
  if (isUrl(t)) return false;
  // Must have a dot (extension) or a slash (directory separator)
  return /[./]/.test(t) && !/\s/.test(t);
}

// Extract candidate file paths from a verbatimQuote that may be markdown or prose.
// Returns paths in priority order: most specific first.
function extractPathCandidates(verbatimQuote: string, expectedValue: string): string[] {
  const candidates: string[] = [];

  // 1. Markdown image or link: ![alt](path) or [text](path)
  for (const m of verbatimQuote.matchAll(/\]\(([^)]+)\)/g)) {
    candidates.push(m[1]);
  }

  // 2. Backtick-wrapped tokens: `path/to/file` or `filename.ext`
  for (const m of verbatimQuote.matchAll(/`([^`]+)`/g)) {
    const content = m[1].trim();
    if (looksLikeFilePath(content)) candidates.push(content);
  }

  // 3. Shell-command tokens that look like file paths (e.g. "cp .env.example .env")
  for (const token of verbatimQuote.split(/\s+/)) {
    const t = token.trim();
    if (
      looksLikeFilePath(t) &&
      (t.startsWith('.') || t.startsWith('/') || t.includes('/'))
    ) {
      candidates.push(t);
    }
  }

  // 4. Parse expectedValue for "File exists at <path>" pattern (Claude reliably emits this)
  const evMatch = expectedValue.match(/File exists at\s+([\S]+)/i);
  if (evMatch) {
    // May be comma/space separated alternatives: "at ./a or ./b"
    const parts = evMatch[1].split(/\s+or\s+/i);
    for (const p of parts) candidates.push(p.trim());
  }

  // 5. Fallback: verbatimQuote itself
  candidates.push(verbatimQuote.trim());

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const k = c.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function findInTree(candidates: string[], fileTreeSet: Set<string>): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeFilePath(candidate);
    const normLower = normalized.toLowerCase();

    // Exact file match
    if (fileTreeSet.has(normLower)) return normalized;

    // Partial suffix match (file in a subdirectory)
    const partial = [...fileTreeSet].find(
      (p) => p.endsWith('/' + normLower) || p === normLower,
    );
    if (partial) return partial;

    // Directory match: candidate ends with '/' or matches as a directory prefix
    const dirPrefix = normLower.endsWith('/') ? normLower : normLower + '/';
    const dirMatch = [...fileTreeSet].find((p) => p.startsWith(dirPrefix));
    if (dirMatch) return normalized;
  }
  return null;
}

async function checkUrl(url: string): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'README-Clew/1.0' },
      redirect: 'follow',
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function urlEvidence(url: string, status: number, ok: boolean): string {
  if (ok)       return `\`${url}\` responds ${status} OK`;
  if (status === 0) return `\`${url}\` timed out or network error`;
  return              `\`${url}\` returned ${status}`;
}

export async function verifyReferences(claims: Claim[], data: RepoData): Promise<VerifierResult> {
  const result: VerifierResult = { verified: [], unverifiable: [], missing: [], contradicted: [] };
  const refClaims = claims.filter((c) => c.category === 'references');
  const fileTreeSet = new Set(data.fileTree.map((p) => p.toLowerCase()));

  // Run all URL checks in parallel for speed
  const urlCheckCache = new Map<string, Promise<{ ok: boolean; status: number }>>();
  function cachedCheckUrl(url: string) {
    if (!urlCheckCache.has(url)) urlCheckCache.set(url, checkUrl(url));
    return urlCheckCache.get(url)!;
  }

  // Pre-flight: kick off URL checks for all claims that have URLs so they run in parallel
  for (const claim of refClaims) {
    const ref = claim.verbatimQuote.trim();
    const urls = isUrl(ref) ? [ref] : extractEmbeddedUrls(ref);
    for (const u of urls) cachedCheckUrl(u);
  }

  for (const claim of refClaims) {
    const ref = claim.verbatimQuote.trim();

    // ── Case 1: verbatimQuote is itself a bare URL ────────────────────────
    if (isUrl(ref)) {
      const { ok, status } = await cachedCheckUrl(ref);
      if (ok) {
        result.verified.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: urlEvidence(ref, status, ok),
        });
      } else if (status === 0) {
        result.unverifiable.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: urlEvidence(ref, status, ok),
        });
      } else {
        result.contradicted.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: urlEvidence(ref, status, ok),
        });
      }
      continue;
    }

    // ── Case 2: verbatimQuote contains embedded URLs (e.g. "git clone https://…",
    //    "![Badge](https://img.shields.io/…)", prose mentioning a live URL) ──
    const embeddedUrls = extractEmbeddedUrls(ref);
    if (embeddedUrls.length > 0) {
      // Check all embedded URLs; use the first one as the primary result
      const [primaryUrl, ...rest] = embeddedUrls;
      const { ok, status } = await cachedCheckUrl(primaryUrl);
      // Kick off remaining checks (already pre-flighted above, just await result)
      await Promise.all(rest.map((u) => cachedCheckUrl(u)));

      if (ok) {
        result.verified.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: urlEvidence(primaryUrl, status, ok),
        });
      } else if (status === 0) {
        result.unverifiable.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: urlEvidence(primaryUrl, status, ok),
        });
      } else {
        result.contradicted.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: urlEvidence(primaryUrl, status, ok),
        });
      }
      continue;
    }

    // ── Case 3: no URL found — try as a file path ─────────────────────────
    const candidates = extractPathCandidates(ref, claim.expectedValue ?? '');
    const fileCandidates = candidates.filter(
      (c) => !isUrl(c) && looksLikeFilePath(c),
    );

    if (fileCandidates.length === 0) {
      result.unverifiable.push({
        category: 'references',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'reference format not recognized — cannot verify',
      });
      continue;
    }

    const found = findInTree(fileCandidates, fileTreeSet);
    if (found) {
      result.verified.push({
        category: 'references',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: `\`${found}\` found in repo file tree`,
        filePath: found,
      });
    } else {
      // Best candidate for the evidence message (first one tried)
      const best = normalizeFilePath(fileCandidates[0]);
      result.contradicted.push({
        category: 'references',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: `\`${best}\` not found in repo file tree`,
      });
    }
  }

  return result;
}
