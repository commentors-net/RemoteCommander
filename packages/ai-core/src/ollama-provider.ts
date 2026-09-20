/**
 * Ollama Local AI Provider Implementation
 * Supports local open-weight models (Llama 3.1, Qwen 2.5 Coder, Mistral, DeepSeek Coder).
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

export interface OllamaProviderOptions {
  baseUrl?: string | undefined;
  providerId?: string | undefined;
  customModels?: ModelInfo[] | undefined;
}

export class OllamaProvider implements AIProvider {
  readonly providerId: string;
  private baseUrl: string;
  private fallbackModels: ModelInfo[];

  constructor(options: OllamaProviderOptions = {}) {
    this.providerId = options.providerId ?? 'ollama';
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.fallbackModels = options.customModels ?? [
      {
        id: 'llama3.1',
        name: 'Llama 3.1 (8B)',
        provider: 'ollama',
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
        isDefault: true,
      },
      {
        id: 'qwen2.5-coder',
        name: 'Qwen 2.5 Coder (7B)',
        provider: 'ollama',
        contextWindow: 32_768,
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        id: 'mistral',
        name: 'Mistral (7B)',
        provider: 'ollama',
        contextWindow: 32_768,
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        id: 'deepseek-coder',
        name: 'DeepSeek Coder (6.7B)',
        provider: 'ollama',
        contextWindow: 16_384,
        supportsTools: true,
        supportsStreaming: true,
      },
    ];
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = (await response.json()) as {
          models?: Array<{ name?: string; details?: { parameter_size?: string } }>;
        };
        if (data.models && data.models.length > 0) {
          return data.models.map((m, idx) => ({
            id: m.name ?? `ollama-model-${idx}`,
            name: `${m.name ?? 'Ollama Model'}${m.details?.parameter_size ? ` (${m.details.parameter_size})` : ''}`,
            provider: 'ollama',
            contextWindow: 32_768,
            supportsTools: true,
            supportsStreaming: true,
            isDefault: idx === 0,
          }));
        }
      }
    } catch {
      // Local daemon may not be active; fall through to fallback models
    }

    return [...this.fallbackModels];
  }

  supportsTools(_model: string): boolean {
    return true;
  }

  normalizeToolCall(raw: unknown): { id: string; toolName: string; argumentsJson: string } {
    const obj = raw as {
      id?: string;
      function?: { name?: string; arguments?: unknown };
    };
    const args = obj.function?.arguments ?? {};
    return {
      id: obj.id ?? `call-ollama-${Date.now()}`,
      toolName: desanitizeToolName(obj.function?.name ?? 'unknown_tool'),
      argumentsJson: typeof args === 'string' ? args : JSON.stringify(args),
    };
  }

  normalizeUsage(raw: unknown): UsageInfo {
    const obj = raw as {
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const prompt = obj.prompt_eval_count ?? 0;
    const completion = obj.eval_count ?? 0;
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string | undefined }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `Ollama returned HTTP ${response.status}. Ensure Ollama is running properly.`,
        };
      }
      return { ok: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: `Ollama not reachable at ${this.baseUrl} (${msg}). Start Ollama with 'ollama serve'.`,
      };
    }
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk> {
    const formattedMessages = request.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content,
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || '',
          tool_calls: m.toolCalls.map((tc) => {
            let parsedArgs: unknown = {};
            try {
              parsedArgs = JSON.parse(tc.argumentsJson);
            } catch {
              parsedArgs = {};
            }
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: sanitizeToolName(tc.toolName),
                arguments: parsedArgs,
              },
            };
          }),
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
      options: {
        temperature: request.temperature ?? 0.2,
      },
    };

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

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    };
    if (signal) {
      fetchOptions.signal = signal;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, fetchOptions);
    } catch (networkErr: unknown) {
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      throw parseHTTPError(
        this.providerId,
        0,
        `Failed to connect to Ollama at ${this.baseUrl}: ${msg}`,
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      throw parseHTTPError(this.providerId, response.status, errText);
    }

    if (!response.body) {
      throw new Error('No response body received from Ollama');
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
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);

            if (data.message?.content) {
              yield { type: 'TEXT_DELTA', delta: data.message.content };
            }

            if (data.message?.tool_calls) {
              for (const tc of data.message.tool_calls) {
                const callId = tc.id ?? `call-ollama-${Date.now()}`;
                const func = tc.function;
                yield {
                  type: 'TOOL_CALL_DELTA',
                  callId,
                  toolName: func?.name ? desanitizeToolName(func.name) : undefined,
                  argsDelta:
                    typeof func?.arguments === 'string'
                      ? func.arguments
                      : JSON.stringify(func?.arguments ?? {}),
                };
              }
            }

            if (data.done) {
              yield { type: 'DONE', finishReason: 'stop' };
              return;
            }
          } catch {
            // Ignore non-JSON or partial line
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
