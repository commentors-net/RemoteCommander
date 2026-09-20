#!/usr/bin/env node

/**
 * Secret scanning script for repository and working tree.
 * Enforces Security Gate A (Master Specification §0.13 Gate A, §26 Gate A).
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT_DIR = process.cwd();

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  'not-important',
]);

const SECRET_REGEXES = [
  { name: 'Private Key Header', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'OpenAI API Key', regex: /\bsk-[a-zA-Z0-9]{20,T3BlbkFJ[a-zA-Z0-9]{20,}\b/ },
  { name: 'Anthropic API Key', regex: /\bsk-ant-[-a-zA-Z0-9_]{20,}\b/ },
  { name: 'Google API Key', regex: /\bAIzaSy[A-Za-z0-9_-]{33}\b/ },
  { name: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub Token', regex: /\bghp_[a-zA-Z0-9]{36}\b/ },
  { name: 'Generic API Secret Assignment', regex: /(?:api_key|apiKey|secret_key|secretKey|password|passphrase)\s*[:=]\s*['"][-a-zA-Z0-9_]{16,}['"]/i },
  { name: 'WHM API Token Assignment', regex: /\bwhm_token\s*[:=]\s*['"][-a-zA-Z0-9_]{20,}['"]/i },
];

let violations = 0;

function scanDirectory(dir) {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      scanDirectory(fullPath);
    } else if (stat.isFile()) {
      // Check file name
      if (/\.(pem|key|pkcs12|pfx|p12)$/i.test(entry) || /^id_(rsa|ed25519|ecdsa)$/i.test(entry)) {
        console.error(`[VIOLATION: FORBIDDEN FILE TYPE] ${relative(ROOT_DIR, fullPath)}`);
        violations++;
        continue;
      }

      // Check file content
      try {
        const content = readFileSync(fullPath, 'utf8');
        for (const { name, regex } of SECRET_REGEXES) {
          if (regex.test(content)) {
            // Avoid flagging the scanner itself
            if (fullPath.includes('scan-secrets.mjs')) continue;

            console.error(`[VIOLATION: ${name}] in ${relative(ROOT_DIR, fullPath)}`);
            violations++;
          }
        }
      } catch {
        // Skip unreadable binary files
      }
    }
  }
}

console.info('Starting security secret scan across repository...');
scanDirectory(ROOT_DIR);

if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} potential secret leak(s).`);
  process.exit(1);
} else {
  console.info('PASSED: Zero plaintext secrets detected. Security Gate A satisfied.');
  process.exit(0);
}
