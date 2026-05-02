import type { Claim, VerifierResult, RepoData } from './types.js';

// Match ES module imports and require() calls
const IMPORT_PATTERN = /^import\s+(?:.*?\s+from\s+)?['"]([^'"./][^'"]*)['"]/gm;
const REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g;

function extractImportedPackages(content: string): Set<string> {
  const packages = new Set<string>();
  for (const pattern of [IMPORT_PATTERN, REQUIRE_PATTERN]) {
    const matches = [...content.matchAll(new RegExp(pattern.source, pattern.flags))];
    for (const m of matches) {
      let pkg = m[1];
      // Handle scoped packages: keep @scope/pkg, strip sub-paths
      if (pkg.startsWith('@')) {
        const parts = pkg.split('/');
        pkg = parts.slice(0, 2).join('/');
      } else {
        pkg = pkg.split('/')[0];
      }
      if (pkg) packages.add(pkg);
    }
  }
  return packages;
}

function getAllPackageNames(packageJson: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const section = packageJson[key];
    if (section && typeof section === 'object') {
      for (const name of Object.keys(section as Record<string, unknown>)) {
        names.add(name);
      }
    }
  }
  return names;
}

export function verifyCoverage(claims: Claim[], data: RepoData): VerifierResult {
  const result: VerifierResult = { verified: [], unverifiable: [], missing: [], contradicted: [] };
  const coverageClaims = claims.filter((c) => c.category === 'coverage');

  // Most READMEs won't have explicit coverage claims
  // For claims like "no external dependencies" or "all dependencies listed"
  if (coverageClaims.length === 0) {
    return result;
  }

  if (!data.packageJson || Object.keys(data.sourceFiles).length === 0) {
    for (const claim of coverageClaims) {
      result.unverifiable.push({
        category: 'coverage',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'insufficient repo data to verify coverage claim',
      });
    }
    return result;
  }

  const allPackageNames = getAllPackageNames(data.packageJson);

  // Find all packages imported in code
  const importedPackages = new Set<string>();
  for (const content of Object.values(data.sourceFiles)) {
    for (const pkg of extractImportedPackages(content)) {
      importedPackages.add(pkg);
    }
  }

  for (const claim of coverageClaims) {
    const text = (claim.claimText + ' ' + claim.verbatimQuote).toLowerCase();

    if (text.includes('no external') || text.includes('zero dependencies') || text.includes('no dependencies')) {
      // Claims there are no external dependencies
      const externalImports = [...importedPackages].filter((pkg) => allPackageNames.has(pkg));
      if (externalImports.length === 0) {
        result.verified.push({
          category: 'coverage',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: 'no external package imports found in scanned source files',
        });
      } else {
        result.contradicted.push({
          category: 'coverage',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `found imports of external packages: ${externalImports.slice(0, 3).join(', ')}`,
        });
      }
    } else {
      // Generic coverage claim — hard to verify definitively
      result.unverifiable.push({
        category: 'coverage',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'coverage completeness requires running the full dependency tree — outside v1 scope',
      });
    }
  }

  return result;
}
