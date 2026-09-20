/**
 * Secret Redaction Engine
 * Authoritative baseline defined in Master Specification §17 (M14), §26 Gate A, and §27.
 * Redacts credentials, private keys, authorization tokens, passwords, and cookies
 * before content enters model context or logs.
 */

import { RedactionCategory, RedactionResult } from '@remote-commander/shared-types';

interface RedactionPattern {
  category: RedactionCategory;
  name: string;
  regex: RegExp;
  mask: string | ((match: string, ...groups: string[]) => string);
}

const REDACTION_PATTERNS: RedactionPattern[] = [
  // 1. Private Key Material
  {
    category: 'PRIVATE_KEY',
    name: 'Private Key Block',
    regex:
      /-----BEGIN (?:[A-Z0-9 ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+)?PRIVATE KEY-----/g,
    mask: '[REDACTED_PRIVATE_KEY]',
  },
  // 2. Authorization Headers
  {
    category: 'AUTH_HEADER',
    name: 'Authorization Header',
    regex:
      /(?:Authorization|Proxy-Authorization)\s*:\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]+=*/gi,
    mask: 'Authorization: [REDACTED_AUTH_TOKEN]',
  },
  // 3. API Keys
  {
    category: 'API_KEY',
    name: 'Anthropic API Key',
    regex: /\bsk-ant-[-a-zA-Z0-9_]{16,}\b/g,
    mask: '[REDACTED_ANTHROPIC_KEY]',
  },
  {
    category: 'API_KEY',
    name: 'OpenAI API Key',
    regex: /\bsk-(?:proj-)?[-a-zA-Z0-9_]{20,}\b/g,
    mask: '[REDACTED_OPENAI_KEY]',
  },
  {
    category: 'API_KEY',
    name: 'Google API Key',
    regex: /\bAIzaSy[A-Za-z0-9_-]{33}\b/g,
    mask: '[REDACTED_GEMINI_KEY]',
  },
  {
    category: 'API_KEY',
    name: 'AWS Access Key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    mask: '[REDACTED_AWS_KEY]',
  },
  {
    category: 'API_KEY',
    name: 'GitHub Token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
    mask: '[REDACTED_GITHUB_TOKEN]',
  },
  // 4. Password fields in CLI commands, configs, or JSON
  {
    category: 'PASSWORD',
    name: 'Password Assignment',
    regex: /(?:password|passwd|pwd|db_pass|db_password)\s*([:=])\s*(["']?)([^\s"',;&|]{3,})\2/gi,
    mask: (_match, sep, quote, _val) => `password${sep}${quote}[REDACTED_PASSWORD]${quote}`,
  },
  // 5. Tokens (JWT, WHM token, generic tokens)
  {
    category: 'TOKEN',
    name: 'JWT Token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    mask: '[REDACTED_JWT_TOKEN]',
  },
  {
    category: 'TOKEN',
    name: 'WHM API Token',
    regex: /\bwhm_token\s*([:=])\s*(["']?)[A-Za-z0-9_-]{16,}\2/gi,
    mask: (_match, sep, quote) => `whm_token${sep}${quote}[REDACTED_WHM_TOKEN]${quote}`,
  },
  // 6. Cookies & Session Identifiers
  {
    category: 'COOKIE',
    name: 'Cookie Header',
    regex: /(?:Set-Cookie|Cookie)\s*:\s*([^;\r\n]+(?:;\s*[^;\r\n]+)*)/gi,
    mask: 'Cookie: [REDACTED_SESSION_COOKIES]',
  },
  {
    category: 'COOKIE',
    name: 'Session Cookie Assignment',
    regex: /(?:PHPSESSID|JSESSIONID|sessionid|connect\.sid)\s*=\s*([a-zA-Z0-9_-]{16,})/gi,
    mask: (_match, _val) => `session_id=[REDACTED_COOKIE]`,
  },
];

/**
 * Scans text for sensitive secrets and credentials, replacing matches with opaque markers.
 */
export function redactSecrets(input: string): RedactionResult {
  if (!input) {
    return {
      redactedText: '',
      hasRedactions: false,
      totalRedactions: 0,
      categories: [],
    };
  }

  let text = input;
  let totalMatches = 0;
  const matchedCategories = new Set<RedactionCategory>();

  for (const pattern of REDACTION_PATTERNS) {
    // Check if pattern matches
    const matches = text.match(pattern.regex);
    if (matches && matches.length > 0) {
      totalMatches += matches.length;
      matchedCategories.add(pattern.category);

      if (typeof pattern.mask === 'function') {
        text = text.replace(
          pattern.regex,
          pattern.mask as (substring: string, ...args: string[]) => string,
        );
      } else {
        text = text.replace(pattern.regex, pattern.mask);
      }
    }
  }

  return {
    redactedText: text,
    hasRedactions: totalMatches > 0,
    totalRedactions: totalMatches,
    categories: Array.from(matchedCategories),
  };
}
