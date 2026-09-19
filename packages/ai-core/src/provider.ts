import { ToolDefinition } from '@remote-commander/tool-schema';
import { ChatMessage } from './messages.js';

/**
 * AI Provider abstraction.
 * Authoritative baseline defined in Master Specification §18.
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
  contextWindow: number;
  supportsTools: boolean;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export type ChatStreamChunk =
  | { type: 'TEXT_DELTA'; delta: string }
  | { type: 'TOOL_CALL_DELTA'; callId: string; toolName?: string; argsDelta: string }
  | { type: 'DONE'; finishReason?: string };

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIProvider {
  readonly providerId: string;
  listModels(): Promise<ModelInfo[]>;
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk>;
  supportsTools(model: string): boolean;
  normalizeToolCall(raw: unknown): { id: string; toolName: string; argumentsJson: string };
  normalizeUsage?(raw: unknown): UsageInfo;
}
