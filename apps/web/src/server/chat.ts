import { OpenAICompatibleProvider } from '@remote-commander/ai-core';
import type { ToolDefinition } from '@remote-commander/tool-schema';
import { config } from './config.js';
import { getSystemMetrics, getPm2Status, getProcessList } from './system.js';
import { listDirectory, readFileContent, writeFileContent } from './files.js';
import { testWhmConnection, listWhmAccounts, createWhmAccount, getWhmServiceStatus } from './whm.js';

export const WEB_TOOLS: ToolDefinition[] = [
  {
    name: 'server.system_info',
    description: 'Inspect hosting server system health, OS, load averages, memory, and disk usage.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'server.disk_usage',
    description: 'Inspect disk usage across partitions on the hosting server.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'server.pm2_status',
    description: 'Inspect PM2 process manager status and list all managed applications (PID, status, memory, CPU, uptime).',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'server.process_list',
    description: 'List top running processes and Node.js applications on the server (PID, CPU, Memory, process name).',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of processes to return (default: 20)' },
      },
    },
  },
  {
    name: 'website.list_files',
    description: 'List files and directories in the website root or subdirectory.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path inside website root (e.g. "public_html" or "wp-content")' },
      },
    },
  },
  {
    name: 'website.read_file',
    description: 'Read the contents of a file in the website root.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file (e.g. "index.html" or "config.php")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'website.write_file',
    description: 'Write or update a file in the website root (creates automatic backup).',
    category: 'server',
    risk: 'MEDIUM',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file' },
        content: { type: 'string', description: 'New text content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'cpanel.whm_status',
    description: 'Check WHM API 1 status, cPanel version, and server connectivity.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cpanel.list_accounts',
    description: 'List all hosted cPanel accounts, domains, disk quotas, and suspension status.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cpanel.create_account',
    description: 'Create a new hosting user account in cPanel/WHM.',
    category: 'cpanel',
    risk: 'MEDIUM',
    timeoutSeconds: 60,
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Account username' },
        domain: { type: 'string', description: 'Primary domain (e.g. "example.com")' },
        plan: { type: 'string', description: 'Hosting package plan name' },
        contactEmail: { type: 'string', description: 'Contact email address' },
      },
      required: ['username', 'domain'],
    },
  },
  {
    name: 'cpanel.service_status',
    description: 'Inspect status of server services (Apache, MySQL, Exim, cPanel).',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: { type: 'object', properties: {} },
  },
];

export async function executeWebTool(name: string, args: Record<string, any>): Promise<any> {
  const normalized = name.replace(/__/g, '.');

  switch (normalized) {
    case 'server.system_info':
    case 'server.disk_usage': {
      const metrics = await getSystemMetrics(config.websiteRoot);
      return metrics;
    }

    case 'server.pm2_status': {
      const pm2 = await getPm2Status();
      return pm2;
    }

    case 'server.process_list': {
      const proc = await getProcessList(args.limit || 20);
      return proc;
    }

    case 'website.list_files': {
      const res = await listDirectory(args.path || '');
      return res;
    }

    case 'website.read_file': {
      if (!args.path) throw new Error('Path is required');
      const res = await readFileContent(args.path);
      return res;
    }

    case 'website.write_file': {
      if (!args.path || args.content === undefined) throw new Error('Path and content are required');
      const res = await writeFileContent(args.path, args.content);
      return res;
    }

    case 'cpanel.whm_status': {
      const res = await testWhmConnection();
      return res;
    }

    case 'cpanel.list_accounts': {
      const res = await listWhmAccounts();
      return res;
    }

    case 'cpanel.create_account': {
      const res = await createWhmAccount(args as any);
      return res;
    }

    case 'cpanel.service_status': {
      const res = await getWhmServiceStatus();
      return res;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function testOpenAiConnection(): Promise<{ success: boolean; message: string; model?: string }> {
  if (!config.openaiApiKey) {
    return { success: false, message: 'OpenAI API key is not configured. Please enter your key in Settings.' };
  }

  const model = config.openaiModel || 'gpt-5-mini';
  try {
    const isReasoning =
      model.startsWith('o1') ||
      model.startsWith('o3') ||
      model.startsWith('gpt-5') ||
      model.includes('reasoning') ||
      model.includes('preview');

    const bodyPayload: Record<string, any> = {
      model,
      messages: [{ role: 'user', content: 'Ping' }],
    };

    if (isReasoning) {
      bodyPayload.max_completion_tokens = 10;
    } else {
      bodyPayload.max_tokens = 10;
    }

    let response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey.trim()}`,
      },
      body: JSON.stringify(bodyPayload),
    });

    let data = (await response.json()) as any;

    if (!response.ok && data?.error?.message?.includes('max_completion_tokens')) {
      delete bodyPayload.max_tokens;
      bodyPayload.max_completion_tokens = 10;
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.openaiApiKey.trim()}`,
        },
        body: JSON.stringify(bodyPayload),
      });
      data = (await response.json()) as any;
    } else if (!response.ok && data?.error?.message?.includes('max_tokens')) {
      delete bodyPayload.max_completion_tokens;
      bodyPayload.max_tokens = 10;
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.openaiApiKey.trim()}`,
        },
        body: JSON.stringify(bodyPayload),
      });
      data = (await response.json()) as any;
    }

    if (!response.ok) {
      const errMsg = data?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      return { success: false, message: `OpenAI error (${response.status}): ${errMsg}` };
    }

    return {
      success: true,
      model,
      message: `OpenAI connection verified successfully! Model: ${model}`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to connect to OpenAI API: ${err.message}`,
    };
  }
}

export async function runWebChat(
  messages: Array<{ role: string; content: string | any }>,
  onChunk: (chunk: string) => void,
  onThought: (thought: string) => void,
  onToolCall: (name: string, args: any, result: any) => void,
): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error('OpenAI API Key is not configured. Please enter your key in Settings.');
  }

  const provider = new OpenAICompatibleProvider({
    apiKey: config.openaiApiKey,
    baseUrl: 'https://api.openai.com/v1',
  });

  const model = config.openaiModel || 'gpt-5-mini';
  const systemPrompt = `You are RemoteCommander Web Agent, an autonomous operations AI assistant running directly on this hosting server (${config.websiteRoot}).
You have direct local tools to inspect system health, check PM2 applications, list running processes, manage website files, and execute WHM/cPanel API operations.
When asked about system metrics, PM2 status, running processes, or website files, invoke the appropriate tools. Be precise, professional, and helpful.`;

  const conversation: any[] = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system' | 'tool', content: m.content })),
  ];

  let loopCount = 0;
  const maxLoops = 6;
  let finalAnswer = '';

  while (loopCount < maxLoops) {
    loopCount++;
    let currentContent = '';
    let toolCalls: any[] = [];

    const stream = provider.streamChat({
      model,
      messages: conversation,
      tools: WEB_TOOLS,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'THOUGHT_DELTA') {
        onThought(chunk.thought);
      } else if (chunk.type === 'TEXT_DELTA') {
        currentContent += chunk.delta;
        onChunk(chunk.delta);
      } else if (chunk.type === 'TOOL_CALL_DELTA') {
        const existing = toolCalls.find((t) => t.id === chunk.callId);
        if (existing) {
          if (chunk.toolName) existing.toolName = chunk.toolName;
          existing.argumentsJson += chunk.argsDelta;
        } else {
          toolCalls.push({
            id: chunk.callId,
            toolName: chunk.toolName || '',
            argumentsJson: chunk.argsDelta,
          });
        }
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      if (currentContent) {
        finalAnswer = currentContent;
        conversation.push({ role: 'assistant', content: currentContent });
      }
      break;
    }

    // Record the assistant turn with the tool calls requested
    conversation.push({
      role: 'assistant',
      content: currentContent || null,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        toolName: tc.toolName,
        argumentsJson: tc.argumentsJson,
      })),
    });

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.argumentsJson || '{}');
      } catch {
        args = {};
      }

      onThought(`Executing tool: ${call.toolName}...`);
      let output = '';
      try {
        const result = await executeWebTool(call.toolName, args);
        output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        onToolCall(call.toolName, args, result);
      } catch (err: any) {
        output = `Error executing tool: ${err.message}`;
        onToolCall(call.toolName, args, { error: err.message });
      }

      conversation.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.toolName,
        content: output,
      });
    }
  }

  if (!finalAnswer.trim()) {
    finalAnswer = 'Completed server inspection. Please review the tool execution trace above, or let me know if you would like me to perform another operation.';
    onChunk(finalAnswer);
  }

  return finalAnswer;
}
