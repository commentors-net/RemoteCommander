/**
 * Anthropic Claude AI Provider Implementation
 * Supports Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus, and custom endpoints.
 * Authoritative baseline defined in Master Specification §16 (M13) & §18.
 */

import {
  AIProvider,
  ChatRequest,
  ChatStreamChunk,
  ModelInfo,
  UsageInfo,
  parseHTTPError,
} from './provider.js';

export interface AnthropicProviderOptions {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  providerId?: string | undefined;
  customModels?: ModelInfo[] | undefined;
}

export class AnthropicProvider implements AIProvider {
  readonly providerId: string;
  private baseUrl: string;
  private apiKey?: string | undefined;
  private customModels: ModelInfo[];

  constructor(options: AnthropicProviderOptions = {}) {
    this.providerId = options.providerId ?? 'anthropic';
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.customModels = options.customModels ?? [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        contextWindow: 200_000,
        supportsTools: true,
        supportsStreaming: true,
        isDefault: true,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        contextWindow: 200_000,
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: 'anthropic',
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
      name?: string;
      input?: unknown;
    };
    return {
      id: obj.id ?? `call-ant-${Date.now()}`,
      toolName: obj.name ?? 'unknown_tool',
      argumentsJson: typeof obj.input === 'string' ? obj.input : JSON.stringify(obj.input ?? {}),
    };
  }

  normalizeUsage(raw: unknown): UsageInfo {
    const obj = raw as {
      input_tokens?: number;
      output_tokens?: number;
    };
    const prompt = obj.input_tokens ?? 0;
    const completion = obj.output_tokens ?? 0;
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string | undefined }> {
    if (!this.apiKey) {
      return { ok: false, error: 'No API key configured for Anthropic' };
    }
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
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
    // 1. Separate system messages from conversational messages
    const systemMessages: string[] = [];
    const rawMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else if (msg.role === 'tool') {
        // Anthropic treats tool output as user role containing tool_result blocks
        rawMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId ?? 'unknown',
              content: msg.content,
            },
          ],
        });
      } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const contentBlocks: unknown[] = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          let parsedInput: unknown = {};
          try {
            parsedInput = JSON.parse(tc.argumentsJson);
          } catch {
            parsedInput = {};
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.toolName,
            input: parsedInput,
          });
        }
        rawMessages.push({
          role: 'assistant',
          content: contentBlocks,
        });
      } else {
        rawMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Merge consecutive messages with identical roles (required by Anthropic API)
    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
    for (const msg of rawMessages) {
      const last = formattedMessages[formattedMessages.length - 1];
      if (last && last.role === msg.role) {
        const lastContent = Array.isArray(last.content)
          ? last.content
          : [{ type: 'text', text: String(last.content) }];
        const newContent = Array.isArray(msg.content)
          ? msg.content
          : [{ type: 'text', text: String(msg.content) }];
        last.content = [...lastContent, ...newContent];
      } else {
        formattedMessages.push({ ...msg });
      }
    }

    // Ensure first message is from user if messages exist
    if (formattedMessages.length > 0 && formattedMessages[0]!.role !== 'user') {
      formattedMessages.unshift({ role: 'user', content: 'Hello' });
    }

    const bodyPayload: Record<string, unknown> = {
      model: request.model,
      messages: formattedMessages,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
      temperature: request.temperature ?? 0.2,
    };

    if (systemMessages.length > 0) {
      bodyPayload.system = systemMessages.join('\n\n');
    }

    if (request.tools && request.tools.length > 0) {
      bodyPayload.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
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
      response = await fetch(`${this.baseUrl}/v1/messages`, fetchOptions);
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

    // Track active content blocks during streaming
    const blockIndexMap = new Map<number, { type: string; id: string; name: string }>();

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

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const eventData = JSON.parse(dataStr);
              const eventType = eventData.type;

              if (eventType === 'content_block_start') {
                const block = eventData.content_block;
                blockIndexMap.set(eventData.index, {
                  type: block.type,
                  id: block.id ?? `call-${eventData.index}`,
                  name: block.name ?? '',
                });
              } else if (eventType === 'content_block_delta') {
                const delta = eventData.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                  yield { type: 'TEXT_DELTA', delta: delta.text };
                } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
                  const blockMeta = blockIndexMap.get(eventData.index);
                  yield {
                    type: 'TOOL_CALL_DELTA',
                    callId: blockMeta?.id ?? `call-${eventData.index}`,
                    toolName: blockMeta?.name,
                    argsDelta: delta.partial_json,
                  };
                }
              } else if (eventType === 'message_delta') {
                const stopReason = eventData.delta?.stop_reason;
                if (stopReason) {
                  yield { type: 'DONE', finishReason: stopReason };
                }
              } else if (eventType === 'message_stop') {
                yield { type: 'DONE', finishReason: 'stop' };
                return;
              } else if (eventType === 'error') {
                const err = eventData.error;
                throw parseHTTPError(
                  this.providerId,
                  400,
                  JSON.stringify(err || { message: 'Anthropic stream error' }),
                );
              }
            } catch (err: unknown) {
              if (err instanceof Error && err.name === 'AIProviderError') {
                throw err;
              }
              // Ignore partial JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
