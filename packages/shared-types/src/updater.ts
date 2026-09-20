/**
 * Updater, Packaging & Release Security Types
 * Authoritative baseline defined in Master Specification §18 (M15), §26, and Appendix A.
 */

export type UpdateStatus =
  | 'IDLE'
  | 'CHECKING'
  | 'UP_TO_DATE'
  | 'UPDATE_AVAILABLE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'VERIFYING'
  | 'ERROR';

export type UpdateChannel = 'stable' | 'beta' | 'nightly';

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string | undefined;
  releaseDate?: string | undefined;
  releaseNotes?: string | undefined;
  downloadUrl?: string | undefined;
  signature?: string | undefined;
  sha256Checksum?: string | undefined;
  signatureValid?: boolean | undefined;
  errorMessage?: string | undefined;
}

export interface UpdateInstallResult {
  success: boolean;
  message: string;
  requiresRestart: boolean;
}

export interface ReleaseAssetInfo {
  platform: 'windows-x64' | 'darwin-x64' | 'darwin-arm64' | 'linux-x64';
  packageType: 'nsis' | 'msi' | 'dmg' | 'app' | 'appimage' | 'deb';
  filename: string;
  sha256: string;
  signature: string;
  downloadUrl: string;
}

export interface ReleaseManifest {
  version: string;
  releaseDate: string;
  notes: string;
  channel: UpdateChannel;
  pubkey: string;
  platforms: Record<string, ReleaseAssetInfo>;
}

export interface SbomComponent {
  name: string;
  version: string;
  ecosystem: 'npm' | 'cargo';
  license?: string | undefined;
  purl?: string | undefined;
}

export interface SbomInfo {
  format: 'CycloneDX' | 'SPDX';
  specVersion: string;
  componentCount: number;
  generatedAt: string;
  sha256: string;
  components?: SbomComponent[] | undefined;
}

export interface SupplyChainCheckResult {
  lockfilesValid: boolean;
  secretsClean: boolean;
  dependencyAuditsPass: boolean;
  sbomPresent: boolean;
  overallPassed: boolean;
  messages: string[];
}
