/**
 * Mock AI Provider for deterministic offline testing and local validation.
 * Authoritative baseline defined in Master Specification §18 and M4 Acceptance Scenario.
 */

import { AIProvider, ChatRequest, ChatStreamChunk, ModelInfo, UsageInfo } from './provider.js';

export class MockAIProvider implements AIProvider {
  readonly providerId = 'mock';

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: 'mock-gpt-4o',
        name: 'Mock Operations Assistant (Local / Offline)',
        provider: 'custom',
        contextWindow: 128_000,
        supportsTools: true,
      },
    ];
  }

  supportsTools(_model: string): boolean {
    return true;
  }

  normalizeToolCall(raw: unknown): { id: string; toolName: string; argumentsJson: string } {
    const obj = raw as {
      id?: string;
      toolName?: string;
      argumentsJson?: string;
    };
    return {
      id: obj.id ?? `call-${Date.now()}`,
      toolName: obj.toolName ?? 'unknown_tool',
      argumentsJson: obj.argumentsJson ?? '{}',
    };
  }

  normalizeUsage(_raw: unknown): UsageInfo {
    return {
      promptTokens: 42,
      completionTokens: 28,
      totalTokens: 70,
    };
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk> {
    if (signal?.aborted) {
      yield { type: 'DONE', finishReason: 'cancelled' };
      return;
    }

    // Check conversation history to see if a tool has just returned results
    const lastMessage = request.messages[request.messages.length - 1];
    const toolMessages = request.messages.filter((m) => m.role === 'tool');

    if (lastMessage?.role === 'tool' && toolMessages.length > 0) {
      // The model is now reasoning over the tool result!
      const lastToolOutput = lastMessage.content;
      yield { type: 'TEXT_DELTA', delta: 'Based on the diagnostic tool output:\n' };

      // Grounded answer synthesis
      if (
        lastToolOutput.includes('load average') ||
        lastToolOutput.includes('Filesystem') ||
        lastToolOutput.includes('up ')
      ) {
        yield {
          type: 'TEXT_DELTA',
          delta: `Based on remote diagnostics executed on production01:\n- Uptime: System is up and healthy (load average: 0.18, 0.12, 0.08).\n- Disk Usage: Root partition (/dev/nvme0n1p1) has 31G available out of 50G (38% used).\nNo immediate operational concerns detected.`,
        };
      } else if (
        lastToolOutput.includes('os') ||
        lastToolOutput.includes('arch') ||
        lastToolOutput.includes('family')
      ) {
        yield {
          type: 'TEXT_DELTA',
          delta: `Your workstation environment metadata has been verified.\nDiagnostics summary:\n${lastToolOutput.slice(0, 300)}...`,
        };
      } else if (lastToolOutput.includes('entries') || lastToolOutput.includes('count')) {
        yield {
          type: 'TEXT_DELTA',
          delta: `Directory contents successfully retrieved from local workstation.\nDetails:\n${lastToolOutput.slice(0, 300)}...`,
        };
      } else {
        yield {
          type: 'TEXT_DELTA',
          delta: `Tool execution completed successfully:\n${lastToolOutput.slice(0, 300)}`,
        };
      }

      yield { type: 'DONE', finishReason: 'stop' };
      return;
    }

    // First turn: inspect user prompt and request appropriate tool
    let userMessage = '';
    for (let i = request.messages.length - 1; i >= 0; i--) {
      const m = request.messages[i];
      if (m && m.role === 'user') {
        userMessage = m.content.toLowerCase();
        break;
      }
    }

    if (
      userMessage.includes('uptime') ||
      userMessage.includes('disk usage') ||
      userMessage.includes('production01')
    ) {
      yield {
        type: 'TEXT_DELTA',
        delta: 'Checking uptime and disk usage on target server...\n',
      };
      yield {
        type: 'TOOL_CALL_DELTA',
        callId: 'call-ssh-prod-001',
        toolName: 'ssh.execute',
        argsDelta: JSON.stringify({
          server_id: 'production01',
          command: 'uptime && df -h',
        }),
      };
      yield { type: 'DONE', finishReason: 'tool_calls' };
      return;
    }

    if (
      userMessage.includes('operating system') ||
      userMessage.includes('system info') ||
      userMessage.includes('os')
    ) {
      yield {
        type: 'TEXT_DELTA',
        delta: 'I will query your local system info to check your OS.\n',
      };
      yield {
        type: 'TOOL_CALL_DELTA',
        callId: 'call-sys-001',
        toolName: 'local.system_info',
        argsDelta: '{}',
      };
      yield { type: 'DONE', finishReason: 'tool_calls' };
      return;
    }

    if (
      userMessage.includes('process') ||
      userMessage.includes('running') ||
      userMessage.includes('task')
    ) {
      yield {
        type: 'TEXT_DELTA',
        delta: 'Querying current running processes on your workstation...\n',
      };
      yield {
        type: 'TOOL_CALL_DELTA',
        callId: 'call-proc-001',
        toolName: 'local.process_list',
        argsDelta: JSON.stringify({ limit: 10 }),
      };
      yield { type: 'DONE', finishReason: 'tool_calls' };
      return;
    }

    if (
      userMessage.includes('file') ||
      userMessage.includes('directory') ||
      userMessage.includes('list')
    ) {
      yield { type: 'TEXT_DELTA', delta: 'Listing directory contents...\n' };
      yield {
        type: 'TOOL_CALL_DELTA',
        callId: 'call-dir-001',
        toolName: 'local.list_directory',
        argsDelta: JSON.stringify({ path: '.' }),
      };
      yield { type: 'DONE', finishReason: 'tool_calls' };
      return;
    }

    // Default conversational response
    yield {
      type: 'TEXT_DELTA',
      delta:
        'I am your secure desktop AI operations assistant. I can inspect system health, files, services, and processes using policy-authorized local and remote tools.',
    };
    yield { type: 'DONE', finishReason: 'stop' };
  }
}
