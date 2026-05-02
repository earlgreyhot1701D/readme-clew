import type { Claim, VerifierResult, RepoData } from './types.js';

// Match process.env.VAR_NAME patterns
const PROCESS_ENV_PATTERN = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
// Match env var names in README claims
const ENV_VAR_NAME_PATTERN = /\b([A-Z_][A-Z0-9_]{2,})\b/g;

function extractEnvVarName(claim: Claim): string | null {
  // Try verbatimQuote first, then claimText
  for (const text of [claim.verbatimQuote, claim.claimText, claim.expectedValue]) {
    const matches = [...text.matchAll(ENV_VAR_NAME_PATTERN)];
    for (const m of matches) {
      const name = m[1];
      // Must look like an env var (UPPER_SNAKE_CASE, at least 3 chars)
      if (/^[A-Z][A-Z0-9_]+$/.test(name) && name.length >= 3) {
        return name;
      }
    }
  }
  return null;
}

function findEnvVarsInCode(sourceFiles: Record<string, string>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [filePath, content] of Object.entries(sourceFiles)) {
    const matches = [...content.matchAll(PROCESS_ENV_PATTERN)];
    for (const m of matches) {
      const varName = m[1];
      if (!found.has(varName)) found.set(varName, []);
      found.get(varName)!.push(filePath);
    }
  }
  return found;
}

export function verifyEnvvars(claims: Claim[], data: RepoData): VerifierResult {
  const result: VerifierResult = { verified: [], unverifiable: [], missing: [], contradicted: [] };
  const envClaims = claims.filter((c) => c.category === 'envvars');

  const codeEnvVars = findEnvVarsInCode(data.sourceFiles);
  const claimedVarNames = new Set<string>();

  for (const claim of envClaims) {
    const varName = extractEnvVarName(claim);

    if (!varName) {
      result.unverifiable.push({
        category: 'envvars',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'could not identify env var name from claim',
      });
      continue;
    }

    claimedVarNames.add(varName);

    if (Object.keys(data.sourceFiles).length === 0) {
      result.unverifiable.push({
        category: 'envvars',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'no source files fetched — cannot verify env var usage',
      });
      continue;
    }

    const foundIn = codeEnvVars.get(varName);
    if (foundIn && foundIn.length > 0) {
      result.verified.push({
        category: 'envvars',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: `\`process.env.${varName}\` read in \`${foundIn[0]}\``,
      });
    } else {
      result.unverifiable.push({
        category: 'envvars',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: `\`process.env.${varName}\` not found in scanned source files — may be in unscanned files`,
      });
    }
  }

  // Missing: env vars used in code but not mentioned in README
  const readmeLower = data.readmeText.toLowerCase();
  for (const [varName, files] of codeEnvVars) {
    if (claimedVarNames.has(varName)) continue;
    if (readmeLower.includes(varName.toLowerCase())) continue;
    // Skip common noise vars
    if (['NODE_ENV', 'PORT', 'HOST', 'PATH', 'HOME', 'USER', 'SHELL', 'PWD'].includes(varName)) continue;
    result.missing.push({
      category: 'envvars',
      claimText: `\`${varName}\` is read in code but not documented in readme`,
      verbatimQuote: varName,
      evidence: `\`process.env.${varName}\` found in \`${files[0]}\` but not mentioned in readme`,
    });
  }

  return result;
}
