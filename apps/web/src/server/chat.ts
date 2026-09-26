import os from 'node:os';
import path from 'node:path';
import { OpenAICompatibleProvider } from '@remote-commander/ai-core';
import type { ToolDefinition } from '@remote-commander/tool-schema';
import { config } from './config.js';
import { getSystemMetrics, getPm2Status, getProcessList } from './system.js';
import { listDirectory, readFileContent, writeFileContent, extractArchive } from './files.js';
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
    name: 'server.extract_zip',
    description: 'Extract a .zip or .tar.gz archive file directly into the website root or a destination folder.',
    category: 'server',
    risk: 'MEDIUM',
    timeoutSeconds: 60,
    inputSchema: {
      type: 'object',
      properties: {
        archivePath: {
          type: 'string',
          description: 'Path or filename of the zip archive (e.g. "update.zip" or "/home/username/update.zip")',
        },
        destination: {
          type: 'string',
          description: 'Destination directory to extract into (e.g. "public_html" or relative subfolder). Defaults to website root.',
        },
      },
      required: ['archivePath'],
    },
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
    description: 'Read the contents of a file within the website root or account home directory (e.g. ".htaccess", "index.html", "package.json"). Cannot read system-level directories like /etc/apache2 or /var/cpanel.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file (e.g. ".htaccess", "public_html/index.php")' },
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

    case 'server.extract_zip':
    case 'website.extract_archive':
    case 'website.extract_zip': {
      const archive = args.archivePath || args.path || args.file;
      if (!archive) throw new Error('Archive path is required');
      const res = await extractArchive(archive, args.destination || args.targetDir || '');
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
  const realHomeDir = os.homedir();
  const realWebsiteRoot = path.resolve(config.websiteRoot);
  const realAppDir = process.cwd();
  const serverUsername = path.basename(realHomeDir);

  const systemPrompt = `You are RemoteCommander Web Agent, an autonomous operations AI assistant running directly on this hosting server.

SERVER ENVIRONMENT REALITIES:
- Account Home Root: ${realHomeDir}
- Website Document Root: ${realWebsiteRoot}
- Web App Directory: ${realAppDir}
- Hosting Account Username: ${serverUsername}

When a user mentions generic paths like "/home/username" or seems confused about directory paths:
1. Explain clearly that their actual username on this server is "${serverUsername}".
2. Offer their actual discovered paths as one-click action options:
   [Use Website Root: ${realWebsiteRoot}]
   [Use Account Home: ${realHomeDir}]
   [Use App Folder: ${realAppDir}]

You have direct local tools to inspect system health, check PM2 applications, list running processes, manage website files, extract zip archives, and execute WHM/cPanel API operations.
When asked about system metrics, PM2 status, running processes, website files, or zip archives, invoke the appropriate tools immediately.

CRITICAL OPERATIONAL RULES:
1. File & Archive Operations:
   - Use website.list_files to list directory contents. Both the website root (${realWebsiteRoot}) and the user home directory (${realHomeDir}) are accessible.
   - Use server.extract_zip to unpack uploaded .zip or .tar.gz archives directly into public_html or a target subfolder!
   - Use website.read_file and website.write_file to inspect and edit website configuration files.
2. Shell & Bash Execution Boundaries:
   - You do NOT have an interactive terminal shell or arbitrary bash command runner tool in this web edition.
   - NEVER hallucinate terminal execution by offering fake approval prompts like "Option A — I check it for you on the server (I will run read-only commands like ls/stat). Reply 'yes' to authorize...". You do not have an 'ls/stat' command runner, so do NOT promise to run commands on authorization.
   - If a user asks to install an uploaded zip file, check for the zip with website.list_files and extract it using server.extract_zip!
   - If a user asks to run an arbitrary custom bash script (.sh), explain that for security, raw bash scripts must be run via cPanel Terminal (cPanel > Advanced > Terminal) or SSH, but you can extract archives, list files, and inspect/edit files directly.
3. Interactive User Choices & Approvals:
   - Whenever asking the user for confirmation, approval, or choosing between options, ALWAYS format the choices cleanly as bracketed tags so they render as one-click action buttons in the web UI!
   - Examples:
     [Option A: Extract archive into public_html]
     [Option B: Inspect archive contents first]
     Or for path selections:
     [Use Website Root: ${realWebsiteRoot}]
     [Use Account Home: ${realHomeDir}]
     Or for approvals:
     [Yes, proceed] [No, cancel]
   - This allows the user to respond with a single click and minimum typing.
4. Web Server & URL Routing Boundaries (Apache / Passenger / Nginx):
   - You CANNOT inspect or read system-level Apache or Passenger configuration files in /etc/apache2/, /etc/httpd/, or /var/cpanel/. These are outside your allowed sandbox roots and require root SSH access. Never call website.read_file on /etc/... paths!
   - NEVER offer options like "Option A: Inspect Apache/Passenger virtual host (WHM/cPanel)" that imply you can inspect root vhost configs.
   - For web routing, URL paths (such as "/commander" or subfolders), and Phusion Passenger application directives, the configuration you CAN inspect and manage is located in the account's local .htaccess files (e.g. website.read_file on ".htaccess" or "public_html/.htaccess" or "public_html/commander/.htaccess").
   - If server-wide Apache/Passenger virtual host changes are required, advise the user to check via WHM or SSH root terminal, but offer to inspect or configure their local .htaccess.
Be direct, helpful, and take action with your actual tools rather than presenting unnecessary menus of options.`;

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
        const errMsg = err.message || 'Unknown error';
        output = `Error executing tool: ${errMsg}`;
        onToolCall(call.toolName, args, {
          error: errMsg,
          details: err.details || undefined,
        });
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
