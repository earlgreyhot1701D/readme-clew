import type { Claim, VerifierResult, RepoData } from './types.js';

const URL_PATTERN = /^https?:\/\//i;

function isUrl(s: string): boolean {
  return URL_PATTERN.test(s.trim());
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
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyReferences(claims: Claim[], data: RepoData): Promise<VerifierResult> {
  const result: VerifierResult = { verified: [], unverifiable: [], missing: [], contradicted: [] };
  const refClaims = claims.filter((c) => c.category === 'references');
  const fileTreeSet = new Set(data.fileTree.map((p) => p.toLowerCase()));

  for (const claim of refClaims) {
    const ref = claim.verbatimQuote.trim();

    if (isUrl(ref)) {
      const { ok, status } = await checkUrl(ref);
      if (ok) {
        result.verified.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `url responds 200 OK`,
        });
      } else if (status === 0) {
        result.unverifiable.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: 'url check timed out or network error',
        });
      } else {
        result.contradicted.push({
          category: 'references',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `url returned ${status}`,
        });
      }
    } else {
      // Extract candidate paths from verbatimQuote + expectedValue
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
  }

  return result;
}
