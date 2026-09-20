import { RiskLevel } from '@remote-commander/shared-types';

export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ToolPropertySchema {
  type: JsonSchemaType;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'local' | 'ssh' | 'server' | 'cpanel' | 'safety' | 'multi_server';
  risk: RiskLevel;
  inputSchema: ToolInputSchema;
  timeoutSeconds: number;
}

export interface ToolInvocationRequest {
  id: string; // Call request ID
  toolName: string;
  arguments: Record<string, unknown>;
  targetServerId?: string;
}

export interface ToolResult {
  callId: string;
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  data?: unknown;
  error?: string;
  truncated?: boolean;
  durationMs: number;
}
