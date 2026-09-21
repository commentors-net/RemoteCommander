import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AnthropicProvider,
  GeminiProvider,
  OllamaProvider,
  OpenAICompatibleProvider,
  MockAIProvider,
  createAIProvider,
  PROVIDER_CAPABILITIES,
  AIProviderError,
  parseHTTPError,
  ToolLoopOrchestrator,
  ToolCallRequest,
  ChatStreamChunk,
  sanitizeToolName,
  desanitizeToolName,
} from '../index.js';

describe('M13 Multi-Provider AI: Capabilities & Factory', () => {
  it('exposes accurate provider capabilities for all supported providers', () => {
    expect(PROVIDER_CAPABILITIES.openai.supportsTools).toBe(true);
    expect(PROVIDER_CAPABILITIES.anthropic.supportsTools).toBe(true);
    expect(PROVIDER_CAPABILITIES.gemini.supportsTools).toBe(true);
    expect(PROVIDER_CAPABILITIES.ollama.supportsTools).toBe(true);

    expect(PROVIDER_CAPABILITIES.openai.requiresApiKey).toBe(true);
    expect(PROVIDER_CAPABILITIES.anthropic.requiresApiKey).toBe(true);
    expect(PROVIDER_CAPABILITIES.gemini.requiresApiKey).toBe(true);
    expect(PROVIDER_CAPABILITIES.ollama.requiresApiKey).toBe(false);

    expect(PROVIDER_CAPABILITIES.anthropic.defaultModel).toContain('claude');
    expect(PROVIDER_CAPABILITIES.gemini.defaultModel).toContain('gemini');
    expect(PROVIDER_CAPABILITIES.ollama.defaultModel).toContain('llama');
  });

  it('creates provider instances via createAIProvider factory', async () => {
    const pAnthropic = await createAIProvider({
      provider: 'anthropic',
      apiKey: 'test-ant-key',
    });
    expect(pAnthropic.providerId).toBe('anthropic');
    const antModels = await pAnthropic.listModels();
    expect(antModels.some((m) => m.id.includes('claude'))).toBe(true);

    const pGemini = await createAIProvider({
      provider: 'gemini',
      apiKey: 'test-gem-key',
    });
    expect(pGemini.providerId).toBe('gemini');
    const gemModels = await pGemini.listModels();
    expect(gemModels.some((m) => m.id.includes('gemini'))).toBe(true);

    const pOllama = await createAIProvider({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    });
    expect(pOllama.providerId).toBe('ollama');
    const ollamaModels = await pOllama.listModels();
    expect(ollamaModels.some((m) => m.id.includes('llama'))).toBe(true);

    const pOpenAI = await createAIProvider({
      provider: 'openai',
      apiKey: 'test-oai-key',
    });
    expect(pOpenAI.providerId).toBe('openai');
  });

  it('resolves API key from keyring secret resolver when secretRef is passed', async () => {
    const resolver = vi.fn().mockResolvedValue('resolved-super-secret-key');
    const provider = await createAIProvider(
      {
        provider: 'anthropic',
        apiKeySecretRef: 'sec-anthropic-keyring-id',
      },
      { secretResolver: resolver },
    );

    expect(resolver).toHaveBeenCalledWith('sec-anthropic-keyring-id');
    expect(provider.providerId).toBe('anthropic');
  });
});

describe('M13 Multi-Provider AI: Error Normalization', () => {
  it('normalizes HTTP 401/403 to AUTHENTICATION_FAILED with actionable hints', () => {
    const err = parseHTTPError(
      'anthropic',
      401,
      JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    );
    expect(err).toBeInstanceOf(AIProviderError);
    expect(err.code).toBe('AUTHENTICATION_FAILED');
    expect(err.status).toBe(401);
    expect(err.message).toContain('invalid x-api-key');
    expect(err.actionableHint).toContain('API key');
  });

  it('normalizes HTTP 429 to RATE_LIMITED with cooldown hint', () => {
    const err = parseHTTPError(
      'openai',
      429,
      JSON.stringify({ error: { message: 'Rate limit exceeded: quota depleted' } }),
    );
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
    expect(err.actionableHint).toContain('Rate limit');
  });

  it('normalizes HTTP 404 to MODEL_NOT_FOUND', () => {
    const err = parseHTTPError(
      'ollama',
      404,
      JSON.stringify({ error: 'model "deepseek-coder-99b" not found, try pulling it' }),
    );
    expect(err.code).toBe('MODEL_NOT_FOUND');
    expect(err.actionableHint).toContain('ollama pull');
  });

  it('normalizes context length errors to CONTEXT_LENGTH_EXCEEDED', () => {
    const err = parseHTTPError(
      'gemini',
      400,
      JSON.stringify({
        error: { message: 'Maximum context length exceeded: 2097153 tokens > 2097152' },
      }),
    );
    expect(err.code).toBe('CONTEXT_LENGTH_EXCEEDED');
    expect(err.actionableHint).toContain('exceeds model context window');
  });

  it('normalizes HTTP 500+ to SERVICE_UNAVAILABLE', () => {
    const err = parseHTTPError('openai', 503, 'Service Temporarily Unavailable');
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.status).toBe(503);
    expect(err.actionableHint).toContain('outage');
  });
});

describe('M13 Multi-Provider AI: Provider-Specific Normalization & Streaming', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('normalizes Anthropic Messages API SSE stream and tool calls', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
    });

    // Mock Anthropic SSE stream
    const sseBody = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":25}}}\n\n',
      'event: content_block_start\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking system"}}\n\n',
      'event: content_block_start\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"server.system_info"}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"server_id\\":\\"srv-prod\\"}"}}\n\n',
      'event: message_delta\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":18}}\n\n',
      'event: message_stop\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const chunks = [];
    for await (const chunk of provider.streamChat({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        { role: 'system', content: 'You are a server ops assistant.' },
        { role: 'user', content: 'Inspect server' },
      ],
      tools: [
        {
          name: 'server.system_info',
          description: 'Get system information',
          category: 'server',
          risk: 'READ_ONLY',
          timeoutSeconds: 15,
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    const textChunks = chunks.filter((c) => c.type === 'TEXT_DELTA');
    const toolChunks = chunks.filter((c) => c.type === 'TOOL_CALL_DELTA');
    const doneChunks = chunks.filter((c) => c.type === 'DONE');

    expect(textChunks.length).toBeGreaterThan(0);
    expect(textChunks[0]?.delta).toBe('Checking system');
    expect(toolChunks.length).toBeGreaterThan(0);
    expect(toolChunks[0]?.callId).toBe('toolu_01');
    expect(toolChunks[0]?.toolName).toBe('server.system_info');
    expect(toolChunks[0]?.argsDelta).toContain('srv-prod');
    expect(doneChunks.length).toBeGreaterThan(0);

    const normTool = provider.normalizeToolCall({
      id: 'toolu_01',
      name: 'server.system_info',
      input: { server_id: 'srv-prod' },
    });
    expect(normTool.id).toBe('toolu_01');
    expect(normTool.toolName).toBe('server.system_info');
    expect(normTool.argumentsJson).toContain('srv-prod');

    const usage = provider.normalizeUsage({ input_tokens: 25, output_tokens: 18 });
    expect(usage.promptTokens).toBe(25);
    expect(usage.completionTokens).toBe(18);
    expect(usage.totalTokens).toBe(43);
  });

  it('normalizes Google Gemini streamGenerateContent and tool calls', async () => {
    const provider = new GeminiProvider({
      apiKey: 'test-gemini-key',
    });

    const sseBody = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Analyzing server health"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"server.service_status","args":{"service_name":"nginx"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":15,"totalTokenCount":45}}\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const chunks = [];
    for await (const chunk of provider.streamChat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Check nginx' }],
    })) {
      chunks.push(chunk);
    }

    const textChunks = chunks.filter((c) => c.type === 'TEXT_DELTA');
    const toolChunks = chunks.filter((c) => c.type === 'TOOL_CALL_DELTA');

    expect(textChunks.length).toBeGreaterThan(0);
    expect(textChunks[0]?.delta).toBe('Analyzing server health');
    expect(toolChunks.length).toBeGreaterThan(0);
    expect(toolChunks[0]?.toolName).toBe('server.service_status');
    expect(toolChunks[0]?.argsDelta).toContain('nginx');

    const norm = provider.normalizeToolCall({
      id: 'call-gem-1',
      functionCall: { name: 'server.service_status', args: { service_name: 'nginx' } },
    });
    expect(norm.toolName).toBe('server.service_status');
    expect(norm.argumentsJson).toContain('nginx');

    const usage = provider.normalizeUsage({
      promptTokenCount: 30,
      candidatesTokenCount: 15,
      totalTokenCount: 45,
    });
    expect(usage.totalTokens).toBe(45);
  });

  it('normalizes Ollama NDJSON stream and tool calls', async () => {
    const provider = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
    });

    const ndjsonBody = [
      JSON.stringify({ message: { role: 'assistant', content: 'Querying status...' } }) + '\n',
      JSON.stringify({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-ol-1',
              function: { name: 'server.system_info', arguments: { server_id: 'srv-local' } },
            },
          ],
        },
        done: false,
      }) + '\n',
      JSON.stringify({ done: true, prompt_eval_count: 20, eval_count: 10 }) + '\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ndjsonBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const chunks = [];
    for await (const chunk of provider.streamChat({
      model: 'llama3.1',
      messages: [{ role: 'user', content: 'Check system info' }],
    })) {
      chunks.push(chunk);
    }

    const textChunks = chunks.filter((c) => c.type === 'TEXT_DELTA');
    const toolChunks = chunks.filter((c) => c.type === 'TOOL_CALL_DELTA');

    expect(textChunks.length).toBeGreaterThan(0);
    expect(textChunks[0]?.delta).toBe('Querying status...');
    expect(toolChunks.length).toBeGreaterThan(0);
    expect(toolChunks[0]?.toolName).toBe('server.system_info');
    expect(toolChunks[0]?.argsDelta).toContain('srv-local');

    const usage = provider.normalizeUsage({ prompt_eval_count: 20, eval_count: 10 });
    expect(usage.totalTokens).toBe(30);
  });
});

describe('M13 Definition of Done: Provider Invariance Across Execution Layer', () => {
  it('executes identical user workflow across different providers without altering tool execution', async () => {
    // Master Specification §16 Definition of Done:
    // "Switching AI provider does not require changes to the execution layer.
    //  Same user workflow should work across supported tool-capable providers without changing server/tool code."

    const executedToolsLog: string[] = [];

    const mockToolExecutor = async (call: ToolCallRequest) => {
      executedToolsLog.push(call.toolName);
      return {
        success: true,
        output: JSON.stringify({
          hostname: 'web-prod-01',
          os: 'linux',
          cores: 8,
          memory_used_mb: 2048,
        }),
      };
    };

    // 1. Run with Mock Provider
    const mockProvider = new MockAIProvider();
    const orchestratorMock = new ToolLoopOrchestrator(mockProvider, []);

    const resultMock = await orchestratorMock.run(
      [{ role: 'user', content: 'What operating system am I running?' }],
      'mock-gpt-4o',
      mockToolExecutor,
    );

    expect(executedToolsLog).toContain('local.system_info');
    expect(resultMock.finalText).toBeDefined();

    // Reset log
    executedToolsLog.length = 0;

    // 2. Run identical tool loop using a simulated Anthropic stream
    // Create a provider subclass that emits tool call then final answer
    class TestSimulatedAnthropicProvider extends AnthropicProvider {
      private turn = 0;
      override async *streamChat(): AsyncIterable<ChatStreamChunk> {
        this.turn++;
        if (this.turn === 1) {
          yield {
            type: 'TOOL_CALL_DELTA',
            callId: 'call-ant-dod',
            toolName: 'local.system_info',
            argsDelta: '{}',
          };
          yield { type: 'DONE', finishReason: 'tool_use' };
        } else {
          yield { type: 'TEXT_DELTA', delta: 'System has 8 cores and 2048MB memory used.' };
          yield { type: 'DONE', finishReason: 'stop' };
        }
      }
    }

    const anthropicProvider = new TestSimulatedAnthropicProvider({ apiKey: 'key' });
    const orchestratorAnthropic = new ToolLoopOrchestrator(anthropicProvider, []);

    const resultAnthropic = await orchestratorAnthropic.run(
      [{ role: 'user', content: 'What operating system am I running?' }],
      'claude-3-5-sonnet-20241022',
      mockToolExecutor, // Exact same executor callback!
    );

    // Verified: The exact same tool was invoked without modifying tool code!
    expect(executedToolsLog).toContain('local.system_info');
    expect(resultAnthropic.finalText).toContain('8 cores');
    expect(resultAnthropic.cancelled).toBe(false);
  });
});

describe('M13 Multi-Provider AI: Tool Name Schema Sanitization (Regex Invariants)', () => {
  const LLM_TOOL_REGEX = /^[a-zA-Z0-9_-]+$/;

  it('converts canonical dot-separated tool names to valid LLM function identifiers and back', () => {
    const testCases = [
      'cpanel.security_advisor',
      'server.system_info',
      'ssh.execute',
      'safety.create_backup',
      'multi_server.diagnostics_matrix',
      'local.list_directory',
    ];

    for (const toolName of testCases) {
      const sanitized = sanitizeToolName(toolName);
      expect(sanitized).toMatch(LLM_TOOL_REGEX);
      expect(sanitized.includes('.')).toBe(false);

      const desanitized = desanitizeToolName(sanitized);
      expect(desanitized).toBe(toolName);
    }
  });

  it('sanitizes tools and assistant tool_calls in OpenAI API requests to strictly match regex', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'sk-openai-test',
    });

    let capturedRequestBody: Record<string, unknown> | undefined;

    const sseBody = [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"cpanel__security_advisor","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedRequestBody = JSON.parse(options.body as string);
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const chunks: ChatStreamChunk[] = [];
    for await (const chunk of provider.streamChat({
      model: 'gpt-5-mini',
      messages: [
        { role: 'user', content: 'check whm security advisor' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_prev',
              toolName: 'server.service_status',
              argumentsJson: '{"service_name":"cpanel"}',
            },
          ],
        },
      ],
      tools: [
        {
          name: 'cpanel.security_advisor',
          description: 'Scan WHM security advisor',
          category: 'cpanel',
          risk: 'READ_ONLY',
          timeoutSeconds: 30,
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(capturedRequestBody).toBeDefined();

    // Verify declared tools conform strictly to OpenAI pattern
    const tools = capturedRequestBody?.tools as Array<{
      type: string;
      function: { name: string };
    }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.function.name).toBe('cpanel__security_advisor');
    expect(tools[0]!.function.name).toMatch(LLM_TOOL_REGEX);

    // Verify assistant tool_calls in history also conform strictly to OpenAI pattern
    const messages = capturedRequestBody?.messages as Array<{
      role: string;
      tool_calls?: Array<{ function: { name: string } }>;
    }>;
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.tool_calls?.[0]?.function.name).toBe('server__service_status');
    expect(assistantMsg?.tool_calls?.[0]?.function.name).toMatch(LLM_TOOL_REGEX);

    // Verify stream chunk emits the canonical RemoteCommander tool name
    const toolDelta = chunks.find((c) => c.type === 'TOOL_CALL_DELTA');
    expect(toolDelta).toBeDefined();
    if (toolDelta?.type === 'TOOL_CALL_DELTA') {
      expect(toolDelta.toolName).toBe('cpanel.security_advisor');
    }
  });

  it('sanitizes tools and functionResponses in Gemini API requests', async () => {
    const provider = new GeminiProvider({
      apiKey: 'gemini-key',
    });

    let capturedRequestBody: Record<string, unknown> | undefined;

    const sseBody = [
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"cpanel__security_advisor","args":{}}}]},"finishReason":"STOP"}]}\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedRequestBody = JSON.parse(options.body as string);
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const chunks: ChatStreamChunk[] = [];
    for await (const chunk of provider.streamChat({
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'user', content: 'Check advisor' },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'cpanel.security_advisor',
          content: 'No critical warnings',
        },
      ],
      tools: [
        {
          name: 'cpanel.security_advisor',
          description: 'Scan WHM security advisor',
          category: 'cpanel',
          risk: 'READ_ONLY',
          timeoutSeconds: 30,
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(capturedRequestBody).toBeDefined();
    const tools = capturedRequestBody?.tools as Array<{
      functionDeclarations: Array<{ name: string }>;
    }>;
    expect(tools[0]!.functionDeclarations[0]!.name).toBe('cpanel__security_advisor');
    expect(tools[0]!.functionDeclarations[0]!.name).toMatch(LLM_TOOL_REGEX);

    const toolChunk = chunks.find((c) => c.type === 'TOOL_CALL_DELTA');
    expect(toolChunk).toBeDefined();
    if (toolChunk?.type === 'TOOL_CALL_DELTA') {
      expect(toolChunk.toolName).toBe('cpanel.security_advisor');
    }
  });

  it('correctly associates OpenAI chunked tool call deltas where subsequent chunks omit callId and function.name', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
    });

    const sseBody = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_chunk_123","type":"function","function":{"name":"ssh__execute","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uptime && df -h\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const chunks: ChatStreamChunk[] = [];
    for await (const chunk of provider.streamChat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Check uptime on RNG1' }],
      tools: [
        {
          name: 'ssh.execute',
          description: 'Execute remote SSH command',
          category: 'ssh',
          risk: 'READ_ONLY',
          timeoutSeconds: 30,
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    const toolChunks = chunks.filter((c) => c.type === 'TOOL_CALL_DELTA');
    expect(toolChunks.length).toBe(3);

    // All chunks must retain the canonical callId and toolName
    for (const tc of toolChunks) {
      if (tc.type === 'TOOL_CALL_DELTA') {
        expect(tc.callId).toBe('call_chunk_123');
        expect(tc.toolName).toBe('ssh.execute');
      }
    }

    // Accumulating arguments should yield full JSON
    const accumulatedArgs = toolChunks
      .map((tc) => (tc.type === 'TOOL_CALL_DELTA' ? tc.argsDelta : ''))
      .join('');
    expect(accumulatedArgs).toBe('{"command":"uptime && df -h"}');
  });
});
