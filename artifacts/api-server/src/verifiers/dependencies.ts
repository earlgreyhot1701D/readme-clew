import type { Claim, VerifierResult, RepoData } from './types.js';

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

// Return the best package name to look up for this claim.
// Strategy: build token candidates from claimText first (more specific about what
// is being claimed), then from verbatimQuote. Use the first token that exactly
// matches a known package — this prevents a combined quote like
// "Express server, TypeScript" from mapping both claims to "express".
function packageNameFromClaim(claim: Claim, allPackages: Set<string>): string {
  const tokenize = (s: string): string[] =>
    s
      .split(/[\s,;:()[\]{}/\\|]+/)
      .map((t) => t.replace(/[`'"]/g, '').toLowerCase())
      .filter((t) => /^@?[a-z][a-z0-9._-]*$/.test(t) && t.length > 1);

  const claimTokens = tokenize(claim.claimText);
  const verbatimTokens = tokenize(claim.verbatimQuote);

  // Priority 1: exact match in allPackages — claimText tokens first
  for (const t of claimTokens) {
    if (allPackages.has(t)) return t;
  }
  for (const t of verbatimTokens) {
    if (allPackages.has(t)) return t;
  }

  // Priority 2: scoped-package match
  const allCandidates = [...claimTokens, ...verbatimTokens];
  for (const t of allCandidates) {
    const scoped = [...allPackages].find((p) => p.endsWith('/' + t) || p === t);
    if (scoped) return scoped;
  }

  // Fallback: first regex match from verbatimQuote (original behaviour)
  const match = claim.verbatimQuote.match(
    /(@?[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)/,
  );
  return match ? match[1].toLowerCase() : claim.verbatimQuote.trim().toLowerCase();
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
    const pkgName = packageNameFromClaim(claim, allPackages);
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
