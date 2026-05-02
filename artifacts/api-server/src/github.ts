// STUB: Multi-language support beyond JS/TS (post-v1)
// Current scope: JavaScript/TypeScript repos only

import { logger } from './lib/logger.js';

const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 30_000;

function getHeaders(): Record<string, string> {
  const pat = process.env['GITHUB_PAT'];
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'README-Clew/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (pat) headers['Authorization'] = `Bearer ${pat}`;
  return headers;
}

async function ghFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers: getHeaders(), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchReadme(owner: string, repo: string): Promise<string> {
  const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/readme`);
  if (res.status === 404) throw new Error(`repo not found or has no readme: ${owner}/${repo}`);
  if (res.status === 403) throw new Error('github rate limit reached. try again later.');
  if (res.status === 401) throw new Error('github authentication failed. check GITHUB_PAT secret.');
  if (!res.ok) throw new Error(`github api error: ${res.status}`);
  const data = (await res.json()) as { content: string; encoding: string };
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

export async function fetchPackageJson(
  owner: string,
  repo: string,
): Promise<Record<string, unknown> | null> {
  const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/package.json`);
  if (res.status === 404) return null; // degrade gracefully — not all repos have package.json
  if (res.status === 403) throw new Error('github rate limit reached. try again later.');
  if (!res.ok) return null;
  const data = (await res.json()) as { content: string; encoding: string };
  try {
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function fetchFileTree(owner: string, repo: string): Promise<string[]> {
  const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`);
  if (!res.ok) {
    logger.warn({ status: res.status, owner, repo }, 'fetchFileTree failed');
    return [];
  }
  const data = (await res.json()) as {
    tree: Array<{ path: string; type: string }>;
    truncated?: boolean;
  };
  if (data.truncated) {
    logger.warn({ owner, repo }, 'file tree truncated by github (large repo)');
  }
  return data.tree.filter((item) => item.type === 'blob').map((item) => item.path);
}

export async function fetchFileContent(
  owner: string,
  repo: string,
  filePath: string,
): Promise<string | null> {
  const res = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { content: string; encoding: string };
  if (data.encoding !== 'base64') return null;
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

const SOURCE_EXTS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '__pycache__',
  '.cache',
  'out',
  '.output',
];

// Fetch package.json files one level deep in packages/ and apps/ (monorepo support)
export async function fetchSubPackageJsons(
  owner: string,
  repo: string,
  fileTree: string[],
): Promise<Record<string, unknown>[]> {
  const pattern = /^(?:(?:packages|apps|artifacts)\/[^/]+|server|frontend|client|backend|api|web)\/package\.json$/i;
  const candidates = fileTree.filter((p) => pattern.test(p));
  const results: Record<string, unknown>[] = [];
  await Promise.allSettled(
    candidates.map(async (filePath) => {
      const content = await fetchFileContent(owner, repo, filePath);
      if (!content) return;
      try {
        const parsed = JSON.parse(content);
        // Store the source path so --filter path-based matching works
        parsed['_path'] = filePath;
        results.push(parsed);
      } catch {
        // ignore malformed package.json
      }
    }),
  );
  return results;
}

export async function fetchSourceFiles(
  owner: string,
  repo: string,
  fileTree: string[],
  maxFiles = 20,
): Promise<Record<string, string>> {
  const sourceFiles = fileTree
    .filter((p) => {
      const lower = p.toLowerCase();
      if (EXCLUDE_DIRS.some((d) => lower === d || lower.startsWith(d + '/'))) return false;
      return SOURCE_EXTS.some((ext) => lower.endsWith(ext));
    })
    .slice(0, maxFiles);

  const results: Record<string, string> = {};
  await Promise.allSettled(
    sourceFiles.map(async (filePath) => {
      const content = await fetchFileContent(owner, repo, filePath);
      if (content) results[filePath] = content;
    }),
  );
  return results;
}
