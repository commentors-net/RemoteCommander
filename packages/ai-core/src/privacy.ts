/**
 * AI Privacy Controls & Context Sanitization
 * Authoritative baseline defined in Master Specification §17 (M14), §27, and §29.
 * Implements content truncation, token-aware log selection, restricted-data mode,
 * and provider privacy disclosure.
 */

import {
  AIProviderType,
  PrivacySettings,
  ProviderDisclosureInfo,
  SanitizedContentResult,
  DEFAULT_PRIVACY_SETTINGS,
  RedactionCategory,
} from '@remote-commander/shared-types';
import { redactSecrets } from './redaction.js';

export interface SanitizeOptions {
  toolName: string;
  privacySettings?: Partial<PrivacySettings> | undefined;
}

/**
 * Sanitizes tool output before it is injected into the AI context window.
 * Applies Secret Redaction, Restricted-Data Mode, and Token-Aware Truncation.
 */
export function sanitizeToolOutputForAI(
  rawOutput: string,
  options: SanitizeOptions,
): SanitizedContentResult {
  const settings: PrivacySettings = {
    ...DEFAULT_PRIVACY_SETTINGS,
    ...options.privacySettings,
  };

  const originalBytes = new TextEncoder().encode(rawOutput).length;
  let text = rawOutput;
  let isRestrictedMode = false;
  let isTruncated = false;

  // 1. Restricted-Data Mode Evaluation
  if (settings.restrictedDataMode) {
    const isFileTool =
      options.toolName.includes('read_file') ||
      options.toolName.includes('file_read') ||
      options.toolName.includes('file_view');

    const isLogTool =
      options.toolName.includes('tail_log') ||
      options.toolName.includes('logs') ||
      (options.toolName.includes('ssh.execute') &&
        (rawOutput.includes('error.log') || rawOutput.includes('access.log')));

    if (isFileTool) {
      isRestrictedMode = true;
      const lineCount = rawOutput.split('\n').length;
      text = [
        `[RESTRICTED DATA MODE ACTIVE]`,
        `Raw file contents are withheld from external AI models to prevent sensitive data leakage.`,
        `File Metadata:`,
        `- Total Lines: ${lineCount}`,
        `- File Size: ${originalBytes} bytes`,
        `- Status: File was read successfully by local runtime.`,
      ].join('\n');
    } else if (isLogTool) {
      isRestrictedMode = true;
      const lines = rawOutput.split('\n');
      const errorLines = lines.filter((l) => /error|crit|fatal|fail/i.test(l));
      const warnLines = lines.filter((l) => /warn/i.test(l));

      text = [
        `[RESTRICTED DATA MODE ACTIVE]`,
        `Raw server log excerpts withheld from external AI models to protect customer IP and user telemetry.`,
        `Log Diagnostic Summary:`,
        `- Total Log Lines: ${lines.length}`,
        `- Error Count: ${errorLines.length}`,
        `- Warning Count: ${warnLines.length}`,
        errorLines.length > 0
          ? `- First Error Pattern: ${errorLines[0]?.slice(0, 150)}...`
          : `- Errors: None detected`,
      ].join('\n');
    }
  }

  // 2. Secret Redaction Engine
  let redactionResult = {
    redactedText: text,
    hasRedactions: false,
    totalRedactions: 0,
    categories: [] as RedactionCategory[],
  };

  if (settings.secretRedactionEnabled) {
    redactionResult = redactSecrets(text);
    text = redactionResult.redactedText;
  }

  // 3. Token-Aware Log Selection & Truncation
  if (text.length > settings.maxCharsPerToolOutput) {
    isTruncated = true;
    const half = Math.floor(settings.maxCharsPerToolOutput / 2);
    const head = text.slice(0, half);
    const tail = text.slice(-half);
    text = `${head}\n\n[... Omitted ${(originalBytes - settings.maxCharsPerToolOutput).toLocaleString()} bytes for token economy ...]\n\n${tail}`;
  }

  // Also enforce line limit on multi-line text
  const lines = text.split('\n');
  if (lines.length > settings.maxLogLinesPerExcerpt) {
    isTruncated = true;
    const headLines = lines.slice(0, Math.floor(settings.maxLogLinesPerExcerpt / 2));
    const tailLines = lines.slice(-Math.floor(settings.maxLogLinesPerExcerpt / 2));
    text = [
      ...headLines,
      `[... ${lines.length - settings.maxLogLinesPerExcerpt} lines omitted for token limits ...]`,
      ...tailLines,
    ].join('\n');
  }

  const sanitizedBytes = new TextEncoder().encode(text).length;

  return {
    content: text,
    originalBytes,
    sanitizedBytes,
    isTruncated,
    isRestrictedMode,
    redactionResult,
  };
}

/**
 * Returns privacy disclosure information for the given AI provider.
 */
export function getProviderDisclosure(provider: AIProviderType): ProviderDisclosureInfo {
  switch (provider) {
    case 'ollama':
      return {
        providerId: 'ollama',
        isLocal: true,
        dataLeavesDevice: false,
        destinationSummary: 'Local Workstation (127.0.0.1:11434)',
        privacyNotice:
          'Completely private and local execution. Zero prompt or server data leaves this device.',
      };

    case 'mock':
      return {
        providerId: 'mock',
        isLocal: true,
        dataLeavesDevice: false,
        destinationSummary: 'In-Memory Test Engine',
        privacyNotice: 'Executed in-memory on local process for testing and validation.',
      };

    case 'anthropic':
      return {
        providerId: 'anthropic',
        isLocal: false,
        dataLeavesDevice: true,
        destinationSummary: 'Anthropic Cloud API (api.anthropic.com)',
        privacyNotice:
          'Prompts and tool outputs are transmitted via TLS to Anthropic. Subject to Anthropic commercial API privacy terms (no training on API data).',
      };

    case 'gemini':
      return {
        providerId: 'gemini',
        isLocal: false,
        dataLeavesDevice: true,
        destinationSummary: 'Google Generative Language API',
        privacyNotice:
          'Prompts and tool outputs are transmitted via TLS to Google. Covered by Google Cloud Enterprise terms.',
      };

    case 'openai':
      return {
        providerId: 'openai',
        isLocal: false,
        dataLeavesDevice: true,
        destinationSummary: 'OpenAI Cloud API (api.openai.com)',
        privacyNotice:
          'Prompts and tool outputs are transmitted via TLS to OpenAI. OpenAI does not train on commercial API inputs.',
      };

    case 'custom':
    default:
      return {
        providerId: 'custom',
        isLocal: false,
        dataLeavesDevice: true,
        destinationSummary: 'Custom API Endpoint',
        privacyNotice:
          'Data is sent to your configured custom endpoint. Verify target endpoint privacy guarantees.',
      };
  }
}
