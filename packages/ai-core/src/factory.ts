/**
 * AI Provider Factory & Capability Registry
 * Unified instantiation, capability inspection, and connectivity testing.
 * Authoritative baseline defined in Master Specification §16 (M13) & §18.
 */

import {
  AIProviderCapabilities,
  AIProviderConfig,
  AIProviderType,
} from '@remote-commander/shared-types';
import { AIProvider } from './provider.js';
import { OpenAICompatibleProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { MockAIProvider } from './mock-provider.js';

export const PROVIDER_CAPABILITIES: Record<AIProviderType, AIProviderCapabilities> = {
  openai: {
    provider: 'openai',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    supportedModels: ['gpt-5-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
  anthropic: {
    provider: 'anthropic',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022',
    supportedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
  },
  gemini: {
    provider: 'gemini',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    supportedModels: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  },
  ollama: {
    provider: 'ollama',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: false,
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'llama3.1',
    supportedModels: ['llama3.1', 'qwen2.5-coder', 'mistral', 'deepseek-coder'],
  },
  custom: {
    provider: 'custom',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8000/v1',
    defaultModel: 'custom-model',
    supportedModels: ['custom-model'],
  },
  mock: {
    provider: 'mock',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: false,
    defaultBaseUrl: 'mock://local',
    defaultModel: 'mock-gpt-4o',
    supportedModels: ['mock-gpt-4o'],
  },
};

export interface FactoryOptions {
  secretResolver?: (secretRef: string) => Promise<string | null>;
}

export async function createAIProvider(
  config: AIProviderConfig,
  options?: FactoryOptions,
): Promise<AIProvider> {
  let resolvedApiKey = config.apiKey;

  // Resolve secret from keyring if apiKey is not directly supplied but secretRef is provided
  if (!resolvedApiKey && config.apiKeySecretRef && options?.secretResolver) {
    const fromKeyring = await options.secretResolver(config.apiKeySecretRef);
    if (fromKeyring) {
      resolvedApiKey = fromKeyring;
    }
  }

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider({
        baseUrl: config.baseUrl || PROVIDER_CAPABILITIES.anthropic.defaultBaseUrl,
        apiKey: resolvedApiKey,
      });

    case 'gemini':
      return new GeminiProvider({
        baseUrl: config.baseUrl || PROVIDER_CAPABILITIES.gemini.defaultBaseUrl,
        apiKey: resolvedApiKey,
      });

    case 'ollama':
      return new OllamaProvider({
        baseUrl: config.baseUrl || PROVIDER_CAPABILITIES.ollama.defaultBaseUrl,
      });

    case 'mock':
      return new MockAIProvider();

    case 'openai':
    case 'custom':
    default:
      return new OpenAICompatibleProvider({
        providerId: config.provider,
        baseUrl:
          config.baseUrl ||
          (config.provider === 'custom'
            ? PROVIDER_CAPABILITIES.custom.defaultBaseUrl
            : PROVIDER_CAPABILITIES.openai.defaultBaseUrl),
        apiKey: resolvedApiKey,
      });
  }
}

export async function testProviderConnection(
  provider: AIProvider,
): Promise<{ ok: boolean; error?: string | undefined }> {
  if (provider.testConnection) {
    return provider.testConnection();
  }
  try {
    const models = await provider.listModels();
    return { ok: models.length > 0 };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
