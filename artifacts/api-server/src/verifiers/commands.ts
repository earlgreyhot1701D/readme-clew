import type { Claim, Finding, VerifierResult, RepoData } from './types.js';

// Commands that are always valid regardless of package.json
const ALWAYS_VALID = new Set([
  'npm install', 'yarn install', 'pnpm install', 'npm ci',
  'yarn', 'pnpm', 'npm i', 'yarn add', 'pnpm add',
  'git clone', 'git init', 'git pull',
]);

function extractScriptName(commandStr: string): string | null {
  // npm run <script>
  const runMatch = commandStr.match(/(?:npm|yarn|pnpm)\s+run\s+([a-zA-Z0-9:_-]+)/);
  if (runMatch) return runMatch[1];

  // npm <script> shorthand (start, test, build, install)
  const shortMatch = commandStr.match(/^(?:npm|yarn|pnpm)\s+(start|test|build|dev|serve|lint|format|check|preview)$/);
  if (shortMatch) return shortMatch[1];

  return null;
}

function getScripts(packageJson: Record<string, unknown>): Record<string, string> {
  const scripts = packageJson['scripts'];
  if (!scripts || typeof scripts !== 'object') return {};
  return scripts as Record<string, string>;
}

function mergeAllScripts(
  root: Record<string, unknown> | null,
  subs: Record<string, unknown>[],
): Record<string, string> {
  const merged: Record<string, string> = {};
  // Root scripts take precedence; subpackage scripts fill in gaps
  for (const sub of subs) {
    for (const [k, v] of Object.entries(getScripts(sub))) {
      if (!(k in merged)) merged[k] = v;
    }
  }
  if (root) {
    for (const [k, v] of Object.entries(getScripts(root))) {
      merged[k] = v; // root wins
    }
  }
  return merged;
}

export function verifyCommands(claims: Claim[], data: RepoData): VerifierResult {
  const result: VerifierResult = { verified: [], unverifiable: [], missing: [], contradicted: [] };
  const commandClaims = claims.filter((c) => c.category === 'commands');

  if (!data.packageJson && data.subPackageJsons.length === 0) {
    for (const claim of commandClaims) {
      const cmd = claim.verbatimQuote.trim();
      if (ALWAYS_VALID.has(cmd.toLowerCase())) {
        result.verified.push({
          category: 'commands',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: 'standard package manager install command',
        });
      } else {
        result.unverifiable.push({
          category: 'commands',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: 'no package.json found — cannot verify scripts',
        });
      }
    }
    return result;
  }

  const scripts = mergeAllScripts(data.packageJson, data.subPackageJsons);
  const documentedScripts = new Set<string>();

  for (const claim of commandClaims) {
    const cmd = claim.verbatimQuote.trim().toLowerCase();

    if (ALWAYS_VALID.has(cmd)) {
      documentedScripts.add('install');
      result.verified.push({
        category: 'commands',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'standard package manager install command',
      });
      continue;
    }

    const scriptName = extractScriptName(claim.verbatimQuote.trim());

    if (scriptName) {
      documentedScripts.add(scriptName);
      if (scripts[scriptName] !== undefined) {
        result.verified.push({
          category: 'commands',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `script \`${scriptName}\` defined in package.json: \`${(scripts[scriptName] as string).slice(0, 60)}\``,
        });
      } else {
        result.contradicted.push({
          category: 'commands',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `no \`${scriptName}\` script in package.json (available: ${Object.keys(scripts).join(', ') || 'none'})`,
        });
      }
    } else {
      result.unverifiable.push({
        category: 'commands',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'command format not recognized — cannot verify against package.json',
      });
    }
  }

  // Missing: scripts in package.json not documented in README
  const readmeLower = data.readmeText.toLowerCase();
  const SKIP_SCRIPTS = new Set(['preinstall', 'postinstall', 'prepare', 'prepublishOnly', 'prepublish']);
  for (const [scriptName] of Object.entries(scripts)) {
    if (SKIP_SCRIPTS.has(scriptName)) continue;
    if (documentedScripts.has(scriptName)) continue;
    const mentioned =
      readmeLower.includes(`run ${scriptName}`) ||
      readmeLower.includes(`npm ${scriptName}`) ||
      readmeLower.includes(`yarn ${scriptName}`) ||
      readmeLower.includes(`pnpm ${scriptName}`);
    if (!mentioned) {
      result.missing.push({
        category: 'commands',
        claimText: `\`${scriptName}\` script exists in package.json but is not documented`,
        verbatimQuote: scriptName,
        evidence: `package.json defines \`"${scriptName}"\` but readme doesn't mention it`,
      });
    }
  }

  return result;
}
