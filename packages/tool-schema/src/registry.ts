import { ToolDefinition } from './schema.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return this.list().filter((t) => t.category === category);
  }
}

/**
 * Standard registry populated with the Master Specification §7 core baseline tools.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Local tools
  registry.register({
    name: 'local.system_info',
    description: 'Retrieve local workstation OS, CPU, memory, and environment metadata.',
    category: 'local',
    risk: 'READ_ONLY',
    timeoutSeconds: 15,
    inputSchema: { type: 'object', properties: {} },
  });

  registry.register({
    name: 'local.list_directory',
    description: 'Safely list directory contents on local workstation.',
    category: 'local',
    risk: 'READ_ONLY',
    timeoutSeconds: 15,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (defaults to current dir)' },
      },
    },
  });

  registry.register({
    name: 'local.read_file',
    description: 'Safely read text file contents on local workstation up to 64KB.',
    category: 'local',
    risk: 'READ_ONLY',
    timeoutSeconds: 15,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  });

  registry.register({
    name: 'local.process_list',
    description: 'List currently running processes on local workstation.',
    category: 'local',
    risk: 'READ_ONLY',
    timeoutSeconds: 15,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max processes to return (default: 20)' },
      },
    },
  });

  // SSH tools
  registry.register({
    name: 'ssh.test_connection',
    description: 'Test SSH network reachability and verify remote host key fingerprint.',
    category: 'ssh',
    risk: 'READ_ONLY',
    timeoutSeconds: 15,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target stable server_id' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'ssh.host_key_info',
    description: 'Query public host key and compute SHA256 fingerprint for an SSH host.',
    category: 'ssh',
    risk: 'READ_ONLY',
    timeoutSeconds: 15,
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Remote hostname or IP' },
        port: { type: 'number', description: 'SSH port (default 22)' },
      },
      required: ['hostname'],
    },
  });

  registry.register({
    name: 'ssh.execute',
    description: 'Execute a command on a remote Linux server via SSH.',
    category: 'ssh',
    risk: 'MEDIUM',
    timeoutSeconds: 60,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target stable server_id' },
        command: { type: 'string', description: 'Shell command string to execute' },
        timeout_seconds: { type: 'number', description: 'Optional command timeout in seconds' },
        working_directory: {
          type: 'string',
          description: 'Optional working directory to change into before executing',
        },
      },
      required: ['server_id', 'command'],
    },
  });

  // Server semantic tools
  registry.register({
    name: 'server.disk_usage',
    description: 'Inspect disk usage and mount points on the target server.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'server.service_status',
    description: 'Check status of a system service (e.g. nginx, mariadb, httpd, php-fpm).',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        service_name: { type: 'string', description: 'Name of the service' },
      },
      required: ['server_id', 'service_name'],
    },
  });

  registry.register({
    name: 'server.service_restart',
    description: 'Restart a system service on the target server.',
    category: 'server',
    risk: 'MEDIUM',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        service_name: { type: 'string', description: 'Name of the service to restart' },
      },
      required: ['server_id', 'service_name'],
    },
  });

  // cPanel / WHM tools
  registry.register({
    name: 'cpanel.list_accounts',
    description: 'List cPanel accounts on a WHM server via official API.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
      },
      required: ['server_id'],
    },
  });

  return registry;
}
