#!/usr/bin/env node

/**
 * Supply Chain Security Verification Script
 * Enforces Master Specification §18 (Milestone M15), §26 Gate A, §27, §29.
 * Validates:
 * 1. Presence of lockfiles (package-lock.json and Cargo.lock).
 * 2. Repository secret scan compliance (Gate A - zero plaintext secrets).
 * 3. Software Bill of Materials (SBOM) generation & CycloneDX v1.5 compliance.
 * 4. Release integrity hash manifests (SHA256SUMS).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT_DIR = process.cwd();

console.info('=== REMOTE COMMANDER: SUPPLY CHAIN SECURITY VERIFICATION ===\n');

let failed = false;

function step(name, fn) {
  process.stdout.write(`[CHECK] ${name}... `);
  try {
    fn();
    console.info('PASSED');
  } catch (err) {
    console.info('FAILED');
    console.error(`  ERROR: ${err.message}`);
    failed = true;
  }
}

// 1. Check lockfiles
step('Lockfiles presence and integrity', () => {
  const npmLock = join(ROOT_DIR, 'package-lock.json');
  const cargoLock = join(ROOT_DIR, 'Cargo.lock');

  if (!existsSync(npmLock)) {
    throw new Error('package-lock.json is missing. Monorepo dependencies must be locked.');
  }
  if (!existsSync(cargoLock)) {
    throw new Error('Cargo.lock is missing. Tauri native dependencies must be locked.');
  }

  // Ensure valid JSON for npm lock
  JSON.parse(readFileSync(npmLock, 'utf8'));
});

// 2. Run Gate A Secret Scanner
step('Security Gate A: Zero plaintext secrets scan', () => {
  const scanScript = join(ROOT_DIR, 'scripts', 'scan-secrets.mjs');
  if (!existsSync(scanScript)) {
    throw new Error('scripts/scan-secrets.mjs not found');
  }

  try {
    execSync(`node "${scanScript}"`, { stdio: 'pipe' });
  } catch (err) {
    const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
    throw new Error(`Secret scanner detected violations:\n${output}`);
  }
});

// 3. Generate and validate SBOM
step('CycloneDX v1.5 SBOM Generation & Verification', () => {
  const genScript = join(ROOT_DIR, 'scripts', 'generate-sbom.mjs');
  if (!existsSync(genScript)) {
    throw new Error('scripts/generate-sbom.mjs not found');
  }

  execSync(`node "${genScript}"`, { stdio: 'pipe' });

  const sbomPath = join(ROOT_DIR, 'dist', 'sbom.cyclonedx.json');
  if (!existsSync(sbomPath)) {
    throw new Error(`Expected SBOM file at ${sbomPath} was not generated`);
  }

  const sbomRaw = readFileSync(sbomPath, 'utf8');
  const sbom = JSON.parse(sbomRaw);

  if (sbom.bomFormat !== 'CycloneDX') {
    throw new Error(`Invalid bomFormat in SBOM: ${sbom.bomFormat}`);
  }
  if (sbom.specVersion !== '1.5') {
    throw new Error(`Invalid specVersion in SBOM: ${sbom.specVersion}, expected 1.5`);
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error('SBOM components list is empty or invalid');
  }

  // 4. Verify SHA256SUMS file matches SBOM
  const sumsPath = join(ROOT_DIR, 'dist', 'SHA256SUMS');
  if (!existsSync(sumsPath)) {
    throw new Error(`Expected SHA256SUMS file at ${sumsPath}`);
  }

  const actualSha256 = createHash('sha256').update(sbomRaw).digest('hex');
  const sumsContent = readFileSync(sumsPath, 'utf8');
  if (!sumsContent.includes(actualSha256)) {
    throw new Error(`SHA256SUMS does not match generated SBOM hash (${actualSha256})`);
  }
});

console.info('\n------------------------------------------------------------');
if (failed) {
  console.error('❌ Supply chain security verification FAILED.');
  process.exit(1);
} else {
  console.info('✅ ALL SUPPLY CHAIN SECURITY CHECKS PASSED.');
  process.exit(0);
}
