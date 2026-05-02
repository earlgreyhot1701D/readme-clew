export interface ParsedRepo {
  owner: string;
  repo: string;
}

export function parseGitHubUrl(url: string): ParsedRepo {
  const trimmed = url.trim().replace(/\/$/, '').replace(/\.git$/, '');
  const pattern = /^(?:https?:\/\/)?github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/;
  const match = trimmed.match(pattern);
  if (!match) {
    throw new Error('invalid github url. expected format: github.com/owner/repo');
  }
  return { owner: match[1], repo: match[2] };
}
