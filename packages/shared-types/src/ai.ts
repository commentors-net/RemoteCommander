/**
 * Multi-Provider AI Shared Types & Error Models
 * Authoritative baseline defined in Master Specification §16 (M13) & §18.
 */

export type AIProviderType = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom' | 'mock';

export type AIErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'NETWORK_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'MISSING_API_KEY'
  | 'UNKNOWN';

export interface AIProviderCapabilities {
  provider: AIProviderType;
  supportsTools: boolean;
  supportsStreaming: boolean;
  requiresApiKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  supportedModels: string[];
}

export interface AIModelDefinition {
  id: string;
  name: string;
  provider: AIProviderType;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  isDefault?: boolean | undefined;
}

export interface AIProviderConfig {
  provider: AIProviderType;
  apiKey?: string | undefined;
  apiKeySecretRef?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
}

export interface NormalizedTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIProviderErrorInfo {
  code: AIErrorCode;
  message: string;
  provider: string;
  status?: number | undefined;
  actionableHint?: string | undefined;
}
