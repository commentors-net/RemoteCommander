/**
 * Google Gemini AI Provider Implementation
 * Supports Gemini 2.0 Flash, Gemini 1.5 Pro, and Gemini 1.5 Flash.
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

export interface GeminiProviderOptions {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  providerId?: string | undefined;
  customModels?: ModelInfo[] | undefined;
}

export class GeminiProvider implements AIProvider {
  readonly providerId: string;
  private baseUrl: string;
  private apiKey?: string | undefined;
  private customModels: ModelInfo[];

  constructor(options: GeminiProviderOptions = {}) {
    this.providerId = options.providerId ?? 'gemini';
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(
      /\/+$/,
      '',
    );
    this.apiKey = options.apiKey;
    this.customModels = options.customModels ?? [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        provider: 'gemini',
        contextWindow: 1_048_576,
        supportsTools: true,
        supportsStreaming: true,
        isDefault: true,
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        provider: 'gemini',
        contextWindow: 2_097_152,
        supportsTools: true,
        supportsStreaming: true,
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        provider: 'gemini',
        contextWindow: 1_048_576,
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
      functionCall?: { name?: string; args?: unknown };
      args?: unknown;
    };
    const name = obj.functionCall?.name ?? obj.name ?? 'unknown_tool';
    const args = obj.functionCall?.args ?? obj.args ?? {};
    return {
      id: obj.id ?? `call-gem-${Date.now()}`,
      toolName: desanitizeToolName(name),
      argumentsJson: typeof args === 'string' ? args : JSON.stringify(args),
    };
  }

  normalizeUsage(raw: unknown): UsageInfo {
    const obj = raw as {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    const prompt = obj.promptTokenCount ?? 0;
    const completion = obj.candidatesTokenCount ?? 0;
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: obj.totalTokenCount ?? prompt + completion,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string | undefined }> {
    if (!this.apiKey) {
      return { ok: false, error: 'No API key configured for Google Gemini' };
    }
    try {
      const url = `${this.baseUrl}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
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
    const systemParts: Array<{ text: string }> = [];
    const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemParts.push({ text: msg.content });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: sanitizeToolName(msg.toolName ?? msg.toolCallId ?? 'unknown_tool'),
                response: { output: msg.content },
              },
            },
          ],
        });
      } else if (msg.role === 'assistant') {
        const parts: unknown[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            let parsedArgs: unknown = {};
            try {
              parsedArgs = JSON.parse(tc.argumentsJson);
            } catch {
              parsedArgs = {};
            }
            parts.push({
              functionCall: {
                name: sanitizeToolName(tc.toolName),
                args: parsedArgs,
              },
            });
          }
        }
        contents.push({
          role: 'model',
          parts,
        });
      } else {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    const bodyPayload: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
      },
    };

    if (request.maxTokens) {
      (bodyPayload.generationConfig as Record<string, unknown>).maxOutputTokens = request.maxTokens;
    }

    if (systemParts.length > 0) {
      bodyPayload.systemInstruction = {
        parts: systemParts,
      };
    }

    if (request.tools && request.tools.length > 0) {
      bodyPayload.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: sanitizeToolName(t.name),
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['x-goog-api-key'] = this.apiKey;
    }

    const endpointUrl = `${this.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

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
      response = await fetch(endpointUrl, fetchOptions);
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

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(dataStr);
              const candidate = parsed.candidates?.[0];
              if (!candidate) continue;

              const parts = candidate.content?.parts ?? [];
              for (const part of parts) {
                if (part.text) {
                  yield { type: 'TEXT_DELTA', delta: part.text };
                }
                if (part.functionCall) {
                  const callId = `call-gem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  yield {
                    type: 'TOOL_CALL_DELTA',
                    callId,
                    toolName: part.functionCall.name
                      ? desanitizeToolName(part.functionCall.name)
                      : undefined,
                    argsDelta: JSON.stringify(part.functionCall.args ?? {}),
                  };
                }
              }

              if (candidate.finishReason) {
                yield { type: 'DONE', finishReason: candidate.finishReason };
              }
            } catch {
              // Ignore invalid JSON / keepalives
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
