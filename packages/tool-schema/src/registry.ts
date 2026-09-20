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
        run_as: {
          type: 'string',
          description:
            'Optional Linux username to execute the command as (e.g. via sudo -u <user> -i)',
        },
      },
      required: ['server_id', 'command'],
    },
  });

  // SSH File Management tools (M8)
  registry.register({
    name: 'ssh.list_directory',
    description: 'List files and directories on remote server with detailed metadata.',
    category: 'ssh',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        path: { type: 'string', description: 'Remote directory path to list (defaults to /)' },
        show_hidden: { type: 'boolean', description: 'Include dotfiles / hidden files' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'ssh.read_file',
    description: 'Safely read remote text or config file with 100KB truncation protection.',
    category: 'ssh',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        path: { type: 'string', description: 'Absolute remote file path to read' },
        max_bytes: { type: 'number', description: 'Maximum bytes to read (default: 100,000)' },
      },
      required: ['server_id', 'path'],
    },
  });

  registry.register({
    name: 'ssh.write_file',
    description:
      'Safely write or update remote file content with automatic backup and diff verification.',
    category: 'ssh',
    risk: 'HIGH',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        path: { type: 'string', description: 'Absolute remote file path to write' },
        content: { type: 'string', description: 'Text content to write' },
        create_backup: {
          type: 'boolean',
          description: 'Create .bak.<timestamp> backup before overwriting',
        },
      },
      required: ['server_id', 'path', 'content'],
    },
  });

  registry.register({
    name: 'ssh.file_info',
    description:
      'Get detailed stat metadata (size, permissions, owner, timestamps) for a remote file or directory.',
    category: 'ssh',
    risk: 'READ_ONLY',
    timeoutSeconds: 20,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        path: { type: 'string', description: 'Remote path to inspect' },
      },
      required: ['server_id', 'path'],
    },
  });

  registry.register({
    name: 'ssh.upload',
    description: 'Upload local text or file content to target remote server path.',
    category: 'ssh',
    risk: 'MEDIUM',
    timeoutSeconds: 60,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        remote_path: { type: 'string', description: 'Destination path on remote server' },
        content: { type: 'string', description: 'File content to upload' },
        overwrite: { type: 'boolean', description: 'Whether to overwrite if file already exists' },
      },
      required: ['server_id', 'remote_path', 'content'],
    },
  });

  registry.register({
    name: 'ssh.download',
    description: 'Download file content from remote server to local workstation.',
    category: 'ssh',
    risk: 'READ_ONLY',
    timeoutSeconds: 60,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        remote_path: { type: 'string', description: 'Remote file path to download' },
      },
      required: ['server_id', 'remote_path'],
    },
  });

  // Server semantic operations tools (Milestone M10, Master Spec §13)
  registry.register({
    name: 'server.system_info',
    description:
      'Inspect basic system info (OS distribution, kernel, hostname, architecture, uptime) on target server.',
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
    name: 'server.memory_usage',
    description:
      'Inspect memory and swap usage (total, used, free, shared, buffer/cache, available) on target server.',
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
    name: 'server.cpu_usage',
    description: 'Inspect CPU utilization, core count, model, and load states on target server.',
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
    name: 'server.load_average',
    description: 'Inspect 1, 5, and 15-minute load averages on target server.',
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
    name: 'server.process_list',
    description:
      'List running processes sorted by resource utilization with PID, user, CPU %, mem %, and command.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        limit: {
          type: 'number',
          description: 'Maximum number of processes to return (default 30)',
        },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'server.network_connections',
    description:
      'Inspect active and listening network sockets/connections (proto, addresses, state, process info).',
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
    description:
      'Check status of a system service (e.g. nginx, mariadb, httpd, php-fpm, crond) across Linux distros.',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        service_name: { type: 'string', description: 'Name or alias of the service' },
      },
      required: ['server_id', 'service_name'],
    },
  });

  registry.register({
    name: 'server.service_start',
    description: 'Start a system service on the target server.',
    category: 'server',
    risk: 'MEDIUM',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        service_name: { type: 'string', description: 'Name or alias of the service to start' },
      },
      required: ['server_id', 'service_name'],
    },
  });

  registry.register({
    name: 'server.service_stop',
    description: 'Stop a system service on the target server.',
    category: 'server',
    risk: 'HIGH',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        service_name: { type: 'string', description: 'Name or alias of the service to stop' },
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
        service_name: { type: 'string', description: 'Name or alias of the service to restart' },
      },
      required: ['server_id', 'service_name'],
    },
  });

  registry.register({
    name: 'server.tail_log',
    description: 'Read the recent lines from a log file (e.g. /var/log/syslog, /var/log/messages).',
    category: 'server',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        path: { type: 'string', description: 'Path to log file (e.g. /var/log/nginx/error.log)' },
        lines: { type: 'number', description: 'Number of lines to tail (default 50, max 500)' },
      },
      required: ['server_id', 'path'],
    },
  });

  // cPanel / WHM tools (Milestone M11, Master Spec §14)
  registry.register({
    name: 'cpanel.server_info',
    description:
      'Inspect WHM/cPanel server version, build, license status, operating system, and active services.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id with WHM/cPanel enabled' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'cpanel.list_accounts',
    description:
      'List all hosted cPanel accounts with user, primary domain, plan, disk usage, and suspended status.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id with WHM/cPanel enabled' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'cpanel.account_info',
    description:
      'Get detailed configuration, limits, contact email, and quota metrics for a specific cPanel account.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        user: { type: 'string', description: 'Username of the cPanel account' },
      },
      required: ['server_id', 'user'],
    },
  });

  registry.register({
    name: 'cpanel.list_domains',
    description:
      'List all domains, subdomains, addon domains, and parked aliases across all accounts on the WHM server.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        user: { type: 'string', description: 'Optional username to filter domains' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'cpanel.service_status',
    description:
      'Inspect status of cPanel server daemons (cpsrvd, cpdavd, cpgreylistd, queueprocd, tailwatchd, etc.).',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        service_name: { type: 'string', description: 'Optional service daemon name to check' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'cpanel.restart_service',
    description:
      'Restart a cPanel service daemon via WHM API (e.g. cpanel, httpd, mysql, dnsadmin, ftpd).',
    category: 'cpanel',
    risk: 'MEDIUM',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        service_name: { type: 'string', description: 'Name of the service daemon to restart' },
      },
      required: ['server_id', 'service_name'],
    },
  });

  registry.register({
    name: 'cpanel.ssl_status',
    description: 'Inspect AutoSSL status and SSL certificate expirations for accounts and domains.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        user: { type: 'string', description: 'Optional account username filter' },
        domain: { type: 'string', description: 'Optional domain name filter' },
      },
      required: ['server_id'],
    },
  });

  registry.register({
    name: 'cpanel.backup_status',
    description:
      'Inspect cPanel automated backup configuration, schedule, retention, and last run status.',
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

  registry.register({
    name: 'cpanel.account_disk_usage',
    description:
      'Inspect detailed disk usage breakdown for an account (public_html, mail, mysql, home).',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        user: { type: 'string', description: 'Username of the cPanel account' },
      },
      required: ['server_id', 'user'],
    },
  });

  registry.register({
    name: 'cpanel.list_php_versions',
    description: 'List installed MultiPHP versions, system default PHP version, and PHP handlers.',
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

  registry.register({
    name: 'cpanel.suspend_account',
    description:
      'Suspend a cPanel account with an operational reason. High-risk state change requiring explicit operator confirmation.',
    category: 'cpanel',
    risk: 'HIGH',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        user: { type: 'string', description: 'Username of the cPanel account to suspend' },
        reason: { type: 'string', description: 'Operational reason for suspension' },
      },
      required: ['server_id', 'user'],
    },
  });

  registry.register({
    name: 'cpanel.unsuspend_account',
    description: 'Unsuspend a previously suspended cPanel account.',
    category: 'cpanel',
    risk: 'MEDIUM',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        user: { type: 'string', description: 'Username of the cPanel account to unsuspend' },
      },
      required: ['server_id', 'user'],
    },
  });

  registry.register({
    name: 'cpanel.security_advisor',
    description:
      'Query WHM Security Advisor recommendations, warnings, and alerts to inspect server hardening and security status.',
    category: 'cpanel',
    risk: 'READ_ONLY',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id with WHM/cPanel enabled' },
      },
      required: ['server_id'],
    },
  });

  // Production Safety & Rollback tools (Milestone M9)
  registry.register({
    name: 'safety.create_backup',
    description:
      'Create an automatic timestamped backup of a remote configuration file before modifications.',
    category: 'safety',
    risk: 'LOW',
    timeoutSeconds: 30,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        file_path: { type: 'string', description: 'Absolute path of the remote file to backup' },
        reason: {
          type: 'string',
          description: 'Reason or operational note for this safety backup',
        },
      },
      required: ['server_id', 'file_path'],
    },
  });

  registry.register({
    name: 'safety.rollback_file',
    description: 'Rollback a modified remote file to a previously created safety backup copy.',
    category: 'safety',
    risk: 'HIGH',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        file_path: { type: 'string', description: 'Target file path to restore' },
        backup_path: { type: 'string', description: 'Specific .bak file path to restore from' },
      },
      required: ['server_id', 'file_path', 'backup_path'],
    },
  });

  registry.register({
    name: 'safety.safe_patch',
    description:
      'Safely patch a configuration file with automated backup, validation check, service reload, and auto-rollback on failure.',
    category: 'safety',
    risk: 'HIGH',
    timeoutSeconds: 60,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
        target_path: { type: 'string', description: 'Remote configuration file to patch' },
        new_content: { type: 'string', description: 'New file content to apply' },
        validation_command: {
          type: 'string',
          description: 'Optional command to validate config syntax (e.g. nginx -t)',
        },
        reload_service: {
          type: 'string',
          description: 'Optional service to reload if validation succeeds (e.g. nginx)',
        },
        auto_rollback_on_failure: {
          type: 'boolean',
          description:
            'Automatically revert to backup if validation or reload fails (default: true)',
        },
      },
      required: ['server_id', 'target_path', 'new_content'],
    },
  });

  registry.register({
    name: 'safety.list_backups',
    description: 'List available safety backups and rollback points for a target server.',
    category: 'safety',
    risk: 'READ_ONLY',
    timeoutSeconds: 20,
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Target server_id' },
      },
      required: ['server_id'],
    },
  });

  // Multi-Server Tools (Milestone M12)
  registry.register({
    name: 'multi_server.execute_batch',
    description:
      'Execute an administrative or diagnostic tool across multiple target servers selected by tag, environment, or server IDs with failure isolation.',
    category: 'multi_server',
    risk: 'HIGH',
    timeoutSeconds: 60,
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'The tool to invoke on each target node (e.g. server.system_info)',
        },
        selector: {
          type: 'object',
          description:
            'Scoping selector ({ type: "all" | "environment" | "tag" | "tags" | "server_ids" })',
        },
        arguments: {
          type: 'object',
          description: 'Arguments passed to each invocation (server_id will be auto-populated)',
        },
        concurrency_limit: {
          type: 'number',
          description: 'Max simultaneous node operations (default 5, bounded 1..20)',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Per-node timeout limit in seconds (default 30)',
        },
      },
      required: ['tool_name', 'selector'],
    },
  });

  registry.register({
    name: 'multi_server.diagnostics_matrix',
    description:
      'Run parallel read-only diagnostics across multiple target servers and return a normalized matrix comparison.',
    category: 'multi_server',
    risk: 'READ_ONLY',
    timeoutSeconds: 45,
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'object',
          description: 'Target servers selector filter',
        },
        diagnostic_type: {
          type: 'string',
          description: 'Diagnostic query type',
          enum: ['system_info', 'disk_usage', 'memory_usage', 'cpu_usage', 'service_status'],
        },
        service_name: {
          type: 'string',
          description: 'Optional service name when diagnostic_type is service_status',
        },
        concurrency_limit: {
          type: 'number',
          description: 'Max concurrent executions (1..20, default 5)',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Per-node execution timeout (default 30)',
        },
      },
      required: ['selector', 'diagnostic_type'],
    },
  });

  return registry;
}
