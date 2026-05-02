import type { ScanResult } from './orchestrator.js';

const MAX_ENTRIES = 50;
const cache = new Map<string, ScanResult>();

export function setCached(owner: string, repo: string, result: ScanResult): void {
  const key = (owner + '/' + repo).toLowerCase();
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
}

export function getCached(owner: string, repo: string): ScanResult | undefined {
  return cache.get((owner + '/' + repo).toLowerCase());
}
