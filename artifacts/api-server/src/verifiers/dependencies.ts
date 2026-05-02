import type { Claim, Finding, VerifierResult, RepoData } from './types.js';

function getAllPackageNames(packageJson: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const section = packageJson[key];
    if (section && typeof section === 'object') {
      for (const name of Object.keys(section as Record<string, unknown>)) {
        names.add(name.toLowerCase());
      }
    }
  }
  return names;
}

function getMainDeps(packageJson: Record<string, unknown>): string[] {
  const deps = packageJson['dependencies'];
  if (!deps || typeof deps !== 'object') return [];
  return Object.keys(deps as Record<string, unknown>);
}

function packageNameFromClaim(claim: Claim): string {
  // Try to extract the package name from verbatimQuote or claimText
  // The verbatim quote often IS the package name (e.g., "express")
  // or contains it embedded in prose
  const candidates = [claim.verbatimQuote.trim(), claim.claimText];
  for (const candidate of candidates) {
    // Match npm package name pattern: may include @scope/ prefix
    const match = candidate.match(/(@?[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)/);
    if (match) return match[1].toLowerCase();
  }
  return claim.verbatimQuote.trim().toLowerCase();
}

function mergeAllPackageNames(
  root: Record<string, unknown> | null,
  subs: Record<string, unknown>[],
): Set<string> {
  const merged = new Set<string>();
  if (root) for (const name of getAllPackageNames(root)) merged.add(name);
  for (const sub of subs) for (const name of getAllPackageNames(sub)) merged.add(name);
  return merged;
}

function mergeAllMainDeps(
  root: Record<string, unknown> | null,
  subs: Record<string, unknown>[],
): string[] {
  const seen = new Set<string>();
  const all: string[] = [];
  const addDeps = (pkg: Record<string, unknown>) => {
    for (const dep of getMainDeps(pkg)) {
      if (!seen.has(dep)) { seen.add(dep); all.push(dep); }
    }
  };
  if (root) addDeps(root);
  for (const sub of subs) addDeps(sub);
  return all;
}

export function verifyDependencies(claims: Claim[], data: RepoData): VerifierResult {
  const result: VerifierResult = { verified: [], unverifiable: [], missing: [], contradicted: [] };
  const depClaims = claims.filter((c) => c.category === 'dependencies');

  if (!data.packageJson && data.subPackageJsons.length === 0) {
    for (const claim of depClaims) {
      result.unverifiable.push({
        category: 'dependencies',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'no package.json found in repo root',
      });
    }
    return result;
  }

  const allPackages = mergeAllPackageNames(data.packageJson, data.subPackageJsons);
  const claimedPackageNames = new Set<string>();

  for (const claim of depClaims) {
    const pkgName = packageNameFromClaim(claim);
    claimedPackageNames.add(pkgName);

    if (allPackages.has(pkgName)) {
      result.verified.push({
        category: 'dependencies',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: `\`${pkgName}\` found in package.json`,
      });
    } else {
      // Try partial match for scoped/aliased packages
      const partial = [...allPackages].find(
        (p) => p.includes(pkgName) || pkgName.includes(p.split('/').pop() ?? p),
      );
      if (partial) {
        result.verified.push({
          category: 'dependencies',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `\`${partial}\` found in package.json (matched from "${pkgName}")`,
        });
      } else {
        result.contradicted.push({
          category: 'dependencies',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `\`${pkgName}\` not found in package.json dependencies`,
        });
      }
    }
  }

  // Missing: main deps in any package.json not mentioned in README
  const readmeLower = data.readmeText.toLowerCase();
  for (const dep of mergeAllMainDeps(data.packageJson, data.subPackageJsons)) {
    const depLower = dep.toLowerCase();
    const shortName = dep.split('/').pop()?.toLowerCase() ?? depLower;
    const mentioned =
      readmeLower.includes(depLower) ||
      readmeLower.includes(shortName) ||
      claimedPackageNames.has(depLower);
    if (!mentioned) {
      result.missing.push({
        category: 'dependencies',
        claimText: `\`${dep}\` is in dependencies but not mentioned in readme`,
        verbatimQuote: dep,
        evidence: `\`${dep}\` listed in package.json dependencies but readme makes no mention of it`,
      });
    }
  }

  return result;
}
