import type { Claim, RepoData, VerifierResult } from './verifiers/types.js';
import { verifyDependencies } from './verifiers/dependencies.js';
import { verifyCommands } from './verifiers/commands.js';
import { verifyReferences } from './verifiers/references.js';
import { verifyEnvvars } from './verifiers/envvars.js';
import { verifyCoverage } from './verifiers/coverage.js';

export interface ScanNotes {
  read: string;
  bucketContext: {
    verified: string | null;
    unverifiable: string | null;
    missing: string | null;
    contradicted: string | null;
  };
}

export interface ScanResult {
  verified: VerifierResult['verified'];
  unverifiable: VerifierResult['unverifiable'];
  missing: VerifierResult['missing'];
  contradicted: VerifierResult['contradicted'];
  meta: {
    owner: string;
    repo: string;
    claimsExtracted: number;
    extractionError?: string;
    readmeTruncated?: boolean;
  };
  notes?: ScanNotes;
}

function mergeResults(results: VerifierResult[]): Omit<ScanResult, 'meta'> {
  return {
    verified: results.flatMap((r) => r.verified),
    unverifiable: results.flatMap((r) => r.unverifiable),
    missing: results.flatMap((r) => r.missing),
    contradicted: results.flatMap((r) => r.contradicted),
  };
}

export async function runScan(
  data: RepoData,
  claims: Claim[],
  extractionError?: string,
  readmeTruncated?: boolean,
): Promise<ScanResult> {
  const [depsResult, cmdsResult, refsResult, envResult, covResult] = await Promise.all([
    Promise.resolve(verifyDependencies(claims, data)),
    Promise.resolve(verifyCommands(claims, data)),
    verifyReferences(claims, data),
    Promise.resolve(verifyEnvvars(claims, data)),
    Promise.resolve(verifyCoverage(claims, data)),
  ]);

  const merged = mergeResults([depsResult, cmdsResult, refsResult, envResult, covResult]);

  return {
    ...merged,
    meta: {
      owner: data.owner,
      repo: data.repo,
      claimsExtracted: claims.length,
      extractionError,
      readmeTruncated,
    },
  };
}
