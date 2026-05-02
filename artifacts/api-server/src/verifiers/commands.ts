import type { Claim, Finding, VerifierResult, RepoData } from './types.js';

// Commands that are always valid regardless of package.json
const ALWAYS_VALID = new Set([
  'npm install', 'yarn install', 'pnpm install', 'npm ci',
  'yarn', 'pnpm', 'npm i', 'yarn add', 'pnpm add',
  'git clone', 'git init', 'git pull',
]);

// pnpm --filter <pkg> run <script>  |  pnpm -F <pkg> run <script>
// also accepts shorthand without "run": pnpm --filter <pkg> <script>
const PNPM_FILTER_RE =
  /^pnpm\s+(?:--filter|-F)\s+(\S+)\s+(?:run\s+)?([a-zA-Z0-9:_.-]+)$/i;

function extractScriptName(commandStr: string): string | null {
  // npm run <script>  /  yarn run <script>  /  pnpm run <script>
  const runMatch = commandStr.match(/(?:npm|yarn|pnpm)\s+run\s+([a-zA-Z0-9:_-]+)/);
  if (runMatch) return runMatch[1];

  // npm/yarn/pnpm <shorthand> (no --filter)
  const shortMatch = commandStr.match(
    /^(?:npm|yarn|pnpm)\s+(start|test|build|dev|serve|lint|format|check|preview)$/,
  );
  if (shortMatch) return shortMatch[1];

  return null;
}

function extractFilterCommand(
  commandStr: string,
): { filter: string; scriptName: string } | null {
  const m = commandStr.match(PNPM_FILTER_RE);
  if (!m) return null;
  return { filter: m[1], scriptName: m[2] };
}

function getScripts(packageJson: Record<string, unknown>): Record<string, string> {
  const scripts = packageJson['scripts'];
  if (!scripts || typeof scripts !== 'object') return {};
  return scripts as Record<string, string>;
}

function mergeAllScripts(
  root: Record<string, unknown> | null,
  subs: SubPackage[],
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const { pkg } of subs) {
    for (const [k, v] of Object.entries(getScripts(pkg))) {
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

interface SubPackage {
  pkg: Record<string, unknown>;
  name: string;
  path?: string;
}

function buildSubPackages(subs: Record<string, unknown>[]): SubPackage[] {
  return subs.map((pkg) => ({
    pkg,
    name: typeof pkg['name'] === 'string' ? pkg['name'] : '',
    path: typeof pkg['_path'] === 'string' ? pkg['_path'] : undefined,
  }));
}

function findSubPackageByFilter(filter: string, subs: SubPackage[]): SubPackage | null {
  for (const sub of subs) {
    // Exact name match:  @workspace/api-server
    if (sub.name && sub.name === filter) return sub;

    // Slug match: api-server  (last segment of @scope/name)
    const slug = sub.name.includes('/') ? sub.name.split('/').pop()! : sub.name;
    if (slug && slug === filter) return sub;

    // Path match: ./artifacts/api-server  or  artifacts/api-server
    if (sub.path) {
      const normPath = sub.path.replace(/^\.\//, '').replace(/\/package\.json$/, '');
      const normFilter = filter.replace(/^\.\//, '');
      if (normPath === normFilter) return sub;
    }
  }
  return null;
}

export function verifyCommands(claims: Claim[], data: RepoData): VerifierResult {
  const result: VerifierResult = { verified: [], unverifiable: [], missing: [], contradicted: [] };
  const commandClaims = claims.filter((c) => c.category === 'commands');

  const subPackages = buildSubPackages(data.subPackageJsons);

  if (!data.packageJson && subPackages.length === 0) {
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

  const scripts = mergeAllScripts(data.packageJson, subPackages);
  const documentedScripts = new Set<string>();

  for (const claim of commandClaims) {
    const cmdRaw = claim.verbatimQuote.trim();
    const cmdLower = cmdRaw.toLowerCase();

    // ── Always-valid install commands ─────────────────────────────────────
    if (ALWAYS_VALID.has(cmdLower)) {
      documentedScripts.add('install');
      result.verified.push({
        category: 'commands',
        claimText: claim.claimText,
        verbatimQuote: claim.verbatimQuote,
        evidence: 'standard package manager install command',
      });
      continue;
    }

    // ── pnpm --filter <pkg> run <script> ─────────────────────────────────
    const filterCmd = extractFilterCommand(cmdRaw);
    if (filterCmd) {
      const { filter, scriptName } = filterCmd;
      documentedScripts.add(scriptName);

      const subPkg = findSubPackageByFilter(filter, subPackages);
      if (subPkg) {
        const subScripts = getScripts(subPkg.pkg);
        const displayName = subPkg.name || filter;
        if (subScripts[scriptName] !== undefined) {
          result.verified.push({
            category: 'commands',
            claimText: claim.claimText,
            verbatimQuote: claim.verbatimQuote,
            evidence: `script \`${scriptName}\` found in \`${displayName}\` package.json`,
          });
        } else {
          result.contradicted.push({
            category: 'commands',
            claimText: claim.claimText,
            verbatimQuote: claim.verbatimQuote,
            evidence: `\`${displayName}\` has no \`${scriptName}\` script (available: ${Object.keys(subScripts).join(', ') || 'none'})`,
          });
        }
      } else if (scripts[scriptName] !== undefined) {
        // Package not individually scanned but script exists somewhere in workspace
        result.verified.push({
          category: 'commands',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `script \`${scriptName}\` found in workspace (package \`${filter}\` matched via merged scripts)`,
        });
      } else {
        result.unverifiable.push({
          category: 'commands',
          claimText: claim.claimText,
          verbatimQuote: claim.verbatimQuote,
          evidence: `package \`${filter}\` not found in scanned package.json files — cannot verify \`${scriptName}\` script`,
        });
      }
      continue;
    }

    // ── Standard npm/yarn/pnpm run <script> ──────────────────────────────
    const scriptName = extractScriptName(cmdRaw);
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

  // ── Missing: scripts in package.json not mentioned in README ─────────────
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
