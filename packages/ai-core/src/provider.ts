import { ToolDefinition } from '@remote-commander/tool-schema';
import {
  AIErrorCode,
  AIProviderErrorInfo,
  AIProviderType,
  NormalizedTokenUsage,
} from '@remote-commander/shared-types';
import { ChatMessage } from './messages.js';

/**
 * AI Provider abstraction and error normalization.
 * Authoritative baseline defined in Master Specification §16 (M13) and §18.
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: AIProviderType;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming?: boolean | undefined;
  isDefault?: boolean | undefined;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
}

export type ChatStreamChunk =
  | { type: 'TEXT_DELTA'; delta: string }
  | {
      type: 'TOOL_CALL_DELTA';
      callId: string;
      toolName?: string | undefined;
      argsDelta: string;
    }
  | { type: 'DONE'; finishReason?: string | undefined };

export type UsageInfo = NormalizedTokenUsage;

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  readonly status?: number | undefined;
  readonly provider: string;
  readonly actionableHint?: string | undefined;

  constructor(info: AIProviderErrorInfo) {
    super(info.message);
    this.name = 'AIProviderError';
    this.code = info.code;
    this.status = info.status;
    this.provider = info.provider;
    this.actionableHint = info.actionableHint;
  }

  toJSON(): AIProviderErrorInfo {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      status: this.status,
      actionableHint: this.actionableHint,
    };
  }
}

export function parseHTTPError(
  provider: string,
  status: number,
  bodyText: string,
): AIProviderError {
  let message = `Provider ${provider} error (${status}): ${bodyText.slice(0, 250)}`;
  let code: AIErrorCode = 'UNKNOWN';
  let hint: string | undefined = undefined;

  // Attempt JSON parsing of error body
  try {
    const parsed = JSON.parse(bodyText);
    const extractedMessage =
      parsed.error?.message ||
      parsed.message ||
      parsed.error ||
      (Array.isArray(parsed.errors) ? parsed.errors.join(', ') : null);
    if (extractedMessage) {
      message = String(extractedMessage);
    }
  } catch {
    // Keep sliced plain text
  }

  const lowerMsg = message.toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    lowerMsg.includes('api key') ||
    lowerMsg.includes('unauthorized')
  ) {
    code = 'AUTHENTICATION_FAILED';
    hint = `Check the API key configured for ${provider} in Settings > Native OS Keyring Credentials.`;
  } else if (status === 429 || lowerMsg.includes('rate limit') || lowerMsg.includes('quota')) {
    code = 'RATE_LIMITED';
    hint = `Rate limit exceeded on ${provider}. Wait a few moments or upgrade tier.`;
  } else if (
    status === 404 ||
    lowerMsg.includes('model not found') ||
    lowerMsg.includes('not found')
  ) {
    code = 'MODEL_NOT_FOUND';
    hint = `Model was not found on ${provider}. For Ollama, try 'ollama pull <model>'.`;
  } else if (
    lowerMsg.includes('context length') ||
    lowerMsg.includes('maximum context') ||
    lowerMsg.includes('prompt too long')
  ) {
    code = 'CONTEXT_LENGTH_EXCEEDED';
    hint = 'The conversation history exceeds model context window limit.';
  } else if (status === 400) {
    code = 'INVALID_REQUEST';
  } else if (status >= 500) {
    code = 'SERVICE_UNAVAILABLE';
    hint = `${provider} service is currently unavailable or encountering an internal outage.`;
  }

  return new AIProviderError({
    code,
    message,
    provider,
    status,
    actionableHint: hint,
  });
}

export interface AIProvider {
  readonly providerId: string;
  listModels(): Promise<ModelInfo[]>;
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk>;
  supportsTools(model: string): boolean;
  normalizeToolCall(raw: unknown): { id: string; toolName: string; argumentsJson: string };
  normalizeUsage?(raw: unknown): UsageInfo;
  testConnection?(): Promise<{ ok: boolean; error?: string | undefined }>;
}
