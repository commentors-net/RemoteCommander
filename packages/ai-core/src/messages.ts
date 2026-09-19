/**
 * Normalized AI message model and untrusted boundary wrapping.
 * Authoritative baseline defined in Master Specification §0.11, §0.13 Gate G, and §18.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallRequest {
  id: string;
  toolName: string;
  argumentsJson: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string; // For role: 'tool'
}

/**
 * Wraps output from remote servers or external tools in clear untrusted delimiters
 * to mitigate prompt injection attacks.
 */
export function wrapUntrustedContent(content: string, source: string): string {
  return [
    `<<< UNTRUSTED EXTERNAL DATA [SOURCE: ${source}] >>>`,
    content,
    `<<< END UNTRUSTED EXTERNAL DATA [SOURCE: ${source}] >>>`,
  ].join('\n');
}
