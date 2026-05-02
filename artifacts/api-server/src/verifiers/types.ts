export type ClaimCategory = 'dependencies' | 'coverage' | 'commands' | 'envvars' | 'references';

export interface Claim {
  category: ClaimCategory;
  claimText: string;
  verbatimQuote: string;
  expectedValue: string;
}

export interface Finding {
  category: ClaimCategory;
  claimText: string;
  verbatimQuote: string;
  evidence: string;
  filePath?: string;
}

export interface VerifierResult {
  verified: Finding[];
  unverifiable: Finding[];
  missing: Finding[];
  contradicted: Finding[];
}

export interface RepoData {
  owner: string;
  repo: string;
  readmeText: string;
  packageJson: Record<string, unknown> | null;
  subPackageJsons: Record<string, unknown>[];
  fileTree: string[];
  sourceFiles: Record<string, string>;
}
