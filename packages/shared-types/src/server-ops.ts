/**
 * Semantic Server Operations Types
 * Authoritative baseline defined in Master Specification §13 (M10).
 */

export interface ServerSystemInfo {
  hostname: string;
  os_name: string;
  os_version: string;
  kernel: string;
  arch: string;
  uptime_seconds: number;
  uptime_human: string;
  distro_family: 'debian' | 'rhel' | 'arch' | 'unknown';
}

export interface ServerDiskUsageEntry {
  filesystem: string;
  mount_point: string;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  use_percentage: number;
}

export interface ServerMemoryUsage {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  shared_bytes: number;
  buff_cache_bytes: number;
  available_bytes: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  swap_free_bytes: number;
}

export interface ServerCpuUsage {
  model_name: string;
  cores: number;
  user_pct: number;
  system_pct: number;
  idle_pct: number;
  iowait_pct: number;
  steal_pct: number;
}

export interface ServerLoadAverage {
  load_1m: number;
  load_5m: number;
  load_15m: number;
}

export interface ServerProcessEntry {
  pid: number;
  user: string;
  cpu_pct: number;
  mem_pct: number;
  status: string;
  command: string;
}

export interface ServerNetworkConnection {
  proto: string;
  local_address: string;
  foreign_address: string;
  state: string;
  pid_program?: string | null | undefined;
}

export interface ServerServiceInfo {
  name: string;
  resolved_name: string;
  load_state: string;
  active_state: string;
  sub_state: string;
  main_pid?: number | null | undefined;
  description?: string | null | undefined;
  is_running: boolean;
  is_enabled?: boolean | null | undefined;
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'status';

export interface ServiceActionResult {
  service_name: string;
  resolved_name: string;
  action: ServiceAction;
  success: boolean;
  active_state_after: string;
  message: string;
}

export interface ServerTailLogResult {
  path: string;
  lines: string[];
  total_lines: number;
  truncated: boolean;
}
