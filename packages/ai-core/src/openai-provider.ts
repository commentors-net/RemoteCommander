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

    const isReasoning =
      request.model.startsWith('o1') ||
      request.model.startsWith('o3') ||
      request.model.startsWith('gpt-5') ||
      request.model.includes('reasoning') ||
      request.model.includes('preview');

    const bodyPayload: Record<string, unknown> = {
      model: request.model,
      messages: formattedMessages,
      stream: true,
    };

    // Reasoning models (o1, o3, gpt-5) only accept default temperature (1) or reject temperature entirely.
    if (!isReasoning) {
      bodyPayload.temperature = request.temperature ?? 0.2;
    }

    if (request.maxTokens) {
      if (isReasoning) {
        bodyPayload.max_completion_tokens = request.maxTokens;
      } else {
        bodyPayload.max_tokens = request.maxTokens;
      }
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
      // Automatic fallback if provider rejects temperature or max_tokens on specific models
      if (
        response.status === 400 &&
        errText.includes('temperature') &&
        bodyPayload.temperature !== undefined
      ) {
        delete bodyPayload.temperature;
        fetchOptions.body = JSON.stringify(bodyPayload);
        try {
          response = await fetch(`${this.baseUrl}/chat/completions`, fetchOptions);
        } catch (retryErr: unknown) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          throw parseHTTPError(this.providerId, 0, `Network request failed: ${msg}`);
        }
      } else if (
        response.status === 400 &&
        errText.includes('max_tokens') &&
        bodyPayload.max_tokens !== undefined
      ) {
        bodyPayload.max_completion_tokens = bodyPayload.max_tokens;
        delete bodyPayload.max_tokens;
        fetchOptions.body = JSON.stringify(bodyPayload);
        try {
          response = await fetch(`${this.baseUrl}/chat/completions`, fetchOptions);
        } catch (retryErr: unknown) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          throw parseHTTPError(this.providerId, 0, `Network request failed: ${msg}`);
        }
      }

      if (!response.ok) {
        const finalErrText = await response.text();
        throw parseHTTPError(this.providerId, response.status, finalErrText);
      }
    }

    if (!response.body) {
      throw new Error('No response body received from provider');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const activeToolCalls = new Map<number, { id: string; name: string }>();

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
              // Check for model thought / reasoning tokens (OpenAI o1/o3/gpt-5, DeepSeek, Ollama /v1)
              const reasoning = delta?.reasoning_content ?? delta?.reasoning;
              if (reasoning) {
                yield { type: 'THOUGHT_DELTA', thought: reasoning };
              }

              if (delta?.content) {
                yield { type: 'TEXT_DELTA', delta: delta.content };
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls as Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>) {
                  const idx = tc.index ?? 0;
                  let callInfo = activeToolCalls.get(idx);
                  if (!callInfo) {
                    callInfo = { id: tc.id ?? `call_${Date.now()}_${idx}`, name: '' };
                    activeToolCalls.set(idx, callInfo);
                  }
                  if (tc.id) {
                    callInfo.id = tc.id;
                  }
                  if (tc.function?.name) {
                    callInfo.name = desanitizeToolName(tc.function.name);
                  }
                  yield {
                    type: 'TOOL_CALL_DELTA',
                    callId: callInfo.id,
                    toolName: callInfo.name || undefined,
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
