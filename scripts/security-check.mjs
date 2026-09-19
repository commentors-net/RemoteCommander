#!/usr/bin/env node

/**
 * Cross-Milestone Security Gates Verification
 * Checks non-negotiable security requirements for M0.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

console.info('=== REMOTE COMMANDER SECURITY CHECK ===\n');

// 1. Run secret scanner
console.info('1. Running secret scan...');
try {
  execSync('node scripts/scan-secrets.mjs', { stdio: 'inherit' });
} catch {
  console.error('Secret scanning check failed!');
  process.exit(1);
}

// 2. Verify .gitignore protection
console.info('\n2. Verifying .gitignore safety rules...');
if (!existsSync('.gitignore')) {
  console.error('Missing .gitignore file!');
  process.exit(1);
}

const gitignoreContent = readFileSync('.gitignore', 'utf8');
const requiredPatterns = ['.env', '*.key', '*.pem', 'node_modules', 'target'];
for (const pattern of requiredPatterns) {
  if (!gitignoreContent.includes(pattern)) {
    console.error(`Missing critical pattern in .gitignore: ${pattern}`);
    process.exit(1);
  }
}
console.info('PASSED: .gitignore contains critical secret and artifact patterns.');

// 3. Verify ADR records exist
console.info('\n3. Verifying required Architecture Decision Records (ADRs)...');
const requiredAdrs = [
  'docs/adr/0001-tauri-react-rust.md',
  'docs/adr/0002-sqlite-local-storage.md',
  'docs/adr/0003-native-os-keyring.md',
  'docs/adr/0004-direct-ssh-no-mandatory-relay.md',
  'docs/adr/0005-policy-engine-outside-llm.md',
  'docs/adr/0006-mcp-not-core.md',
];

for (const adr of requiredAdrs) {
  if (!existsSync(adr)) {
    console.error(`Missing required ADR: ${adr}`);
    process.exit(1);
  }
}
console.info('PASSED: All 6 required foundation ADRs are present.');

console.info('\nALL M0 SECURITY CHECKS PASSED SUCCESSFULLY.');
