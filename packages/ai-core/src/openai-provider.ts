/**
 * OpenAI-Compatible AI Provider Implementation
 * Supports OpenAI, Ollama (/v1), LMStudio, OpenRouter, and compatible endpoints.
 * Authoritative baseline defined in Master Specification §16 (M13) & §18.
 */

import {
  AIProvider,
  ChatRequest,
  ChatStreamChunk,
  ModelInfo,
  UsageInfo,
  parseHTTPError,
  sanitizeToolName,
  desanitizeToolName,
} from './provider.js';

export interface OpenAIProviderOptions {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  providerId?: string | undefined;
  customModels?: ModelInfo[] | undefined;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly providerId: string;
  private baseUrl: string;
  private apiKey?: string | undefined;
  private customModels: ModelInfo[];

  constructor(options: OpenAIProviderOptions = {}) {
    this.providerId = options.providerId ?? 'openai';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.customModels = options.customModels ?? [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        isDefault: true,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        provider: 'openai',
        contextWindow: 200_000,
        supportsTools: true,
        supportsStreaming: true,
      },
    ];
  }

  async listModels(): Promise<ModelInfo[]> {
    return [...this.customModels];
  }

  supportsTools(_model: string): boolean {
    return true;
  }

  normalizeToolCall(raw: unknown): { id: string; toolName: string; argumentsJson: string } {
    const obj = raw as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    return {
      id: obj.id ?? `call-${Date.now()}`,
      toolName: desanitizeToolName(obj.function?.name ?? 'unknown_tool'),
      argumentsJson: obj.function?.arguments ?? '{}',
    };
  }

  normalizeUsage(raw: unknown): UsageInfo {
    const obj = raw as {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    return {
      promptTokens: obj.prompt_tokens ?? 0,
      completionTokens: obj.completion_tokens ?? 0,
      totalTokens: obj.total_tokens ?? 0,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string | undefined }> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        const text = await response.text();
        const err = parseHTTPError(this.providerId, response.status, text);
        return { ok: false, error: err.message };
      }
      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Connection failed: ${msg}` };
    }
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk> {
    const formattedMessages = request.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId ?? 'unknown',
          content: m.content,
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: sanitizeToolName(tc.toolName),
              arguments: tc.argumentsJson,
            },
          })),
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    const bodyPayload: Record<string, unknown> = {
      model: request.model,
      messages: formattedMessages,
      stream: true,
      temperature: request.temperature ?? 0.2,
    };

    if (request.maxTokens) {
      bodyPayload.max_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      bodyPayload.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: sanitizeToolName(t.name),
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    };
    if (signal) {
      fetchOptions.signal = signal;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, fetchOptions);
    } catch (networkErr: unknown) {
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      throw parseHTTPError(this.providerId, 0, `Network request failed: ${msg}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw parseHTTPError(this.providerId, response.status, errText);
    }

    if (!response.body) {
      throw new Error('No response body received from provider');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          yield { type: 'DONE', finishReason: 'cancelled' };
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            yield { type: 'DONE', finishReason: 'stop' };
            return;
          }

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(dataStr);
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (delta?.content) {
                yield { type: 'TEXT_DELTA', delta: delta.content };
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  yield {
                    type: 'TOOL_CALL_DELTA',
                    callId: tc.id ?? '',
                    toolName: tc.function?.name ? desanitizeToolName(tc.function.name) : undefined,
                    argsDelta: tc.function?.arguments ?? '',
                  };
                }
              }

              if (choice.finish_reason) {
                yield { type: 'DONE', finishReason: choice.finish_reason };
              }
            } catch {
              // Ignore non-JSON keepalive chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
