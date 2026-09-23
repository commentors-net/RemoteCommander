import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface SystemMetrics {
  hostname: string;
  platform: string;
  release: string;
  uptimeSeconds: number;
  cpuModel: string;
  cpuCores: number;
  loadAverage: number[];
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disk: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
    percentUsed: number;
  };
  timestamp: string;
}

export async function getSystemMetrics(targetDir?: string): Promise<SystemMetrics> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const loadAvg = os.loadavg();

  let diskInfo = {
    totalGb: 50,
    usedGb: 15,
    freeGb: 35,
    percentUsed: 30,
  };

  try {
    if (process.platform === 'win32') {
      const drive = (targetDir || process.cwd()).substring(0, 2);
      const { stdout } = await execAsync(`powershell -Command "Get-PSDrive '${drive[0]}' | Select-Object Used, Free"`);
      const lines = stdout.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1]?.trim().split(/\s+/) || [];
        const used = Number.parseInt(parts[0] || '0', 10);
        const free = Number.parseInt(parts[1] || '0', 10);
        const total = used + free;
        if (total > 0) {
          diskInfo = {
            totalGb: Math.round(total / (1024 * 1024 * 1024)),
            usedGb: Math.round(used / (1024 * 1024 * 1024)),
            freeGb: Math.round(free / (1024 * 1024 * 1024)),
            percentUsed: Math.round((used / total) * 100),
          };
        }
      }
    } else {
      // Linux / macOS df
      const { stdout } = await execAsync(`df -k "${targetDir || '/'}" | tail -n 1`);
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 5) {
        const totalKb = Number.parseInt(parts[1] || '0', 10);
        const usedKb = Number.parseInt(parts[2] || '0', 10);
        const freeKb = Number.parseInt(parts[3] || '0', 10);
        const pctStr = (parts[4] || '0%').replace('%', '');
        diskInfo = {
          totalGb: Math.round(totalKb / (1024 * 1024)),
          usedGb: Math.round(usedKb / (1024 * 1024)),
          freeGb: Math.round(freeKb / (1024 * 1024)),
          percentUsed: Number.parseInt(pctStr, 10),
        };
      }
    }
  } catch {
    // Fallback to defaults
  }

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.arch()}`,
    release: os.release(),
    uptimeSeconds: Math.floor(os.uptime()),
    cpuModel: cpus[0]?.model || 'Generic CPU',
    cpuCores: cpus.length,
    loadAverage: loadAvg,
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: Math.round((usedMem / totalMem) * 100),
    },
    disk: diskInfo,
    timestamp: new Date().toISOString(),
  };
}

export interface Pm2AppInfo {
  name: string;
  pm_id: number;
  pid?: number | undefined;
  status: string;
  uptimeSeconds?: number | undefined;
  memoryMb?: number | undefined;
  cpuPercent?: number | undefined;
  restarts?: number | undefined;
}

export interface Pm2StatusResult {
  pm2Available: boolean;
  appsCount: number;
  apps: Pm2AppInfo[];
  message: string;
}

export async function getPm2Status(): Promise<Pm2StatusResult> {
  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: 10000 });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return {
        pm2Available: true,
        appsCount: 0,
        apps: [],
        message: 'PM2 is running, but no applications are registered under it.',
      };
    }

    const list = JSON.parse(trimmed);
    if (!Array.isArray(list)) {
      return {
        pm2Available: true,
        appsCount: 0,
        apps: [],
        message: 'PM2 returned non-array response.',
      };
    }

    const apps: Pm2AppInfo[] = list.map((item: any) => ({
      name: item.name || 'unnamed',
      pm_id: item.pm_id ?? -1,
      pid: item.pid,
      status: item.pm2_env?.status || 'unknown',
      uptimeSeconds: item.pm2_env?.pm_uptime ? Math.floor((Date.now() - item.pm2_env.pm_uptime) / 1000) : undefined,
      memoryMb: item.monit?.memory ? Math.round(item.monit.memory / (1024 * 1024)) : 0,
      cpuPercent: item.monit?.cpu ?? 0,
      restarts: item.pm2_env?.restart_time ?? 0,
    }));

    return {
      pm2Available: true,
      appsCount: apps.length,
      apps,
      message: `Found ${apps.length} application(s) running under PM2.`,
    };
  } catch (err: any) {
    const msg = err.message || '';
    if (
      msg.includes('not found') ||
      msg.includes('not recognized') ||
      msg.includes('ENOENT') ||
      msg.includes('CommandNotFoundException')
    ) {
      return {
        pm2Available: false,
        appsCount: 0,
        apps: [],
        message:
          'PM2 command is not installed or not in PATH on this hosting server. If applications are managed by cPanel Application Manager (Phusion Passenger) or systemd, they run as standalone services without PM2.',
      };
    }
    return {
      pm2Available: false,
      appsCount: 0,
      apps: [],
      message: `Failed to query PM2: ${msg.slice(0, 200)}`,
    };
  }
}

export interface ProcessItem {
  pid: number;
  name: string;
  cpuPercent?: number | undefined;
  memoryMb?: number | undefined;
}

export async function getProcessList(limit: number = 20): Promise<{ processes: ProcessItem[]; count: number }> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        `powershell -Command "Get-Process | Sort-Object -Descending WorkingSet64 | Select-Object -First ${limit} Id, ProcessName, WorkingSet64, CPU | ConvertTo-Json"`,
        { timeout: 10000 },
      );
      const parsed = JSON.parse(stdout.trim() || '[]');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const processes: ProcessItem[] = items.filter(Boolean).map((p: any) => ({
        pid: p.Id,
        name: p.ProcessName,
        memoryMb: Math.round((p.WorkingSet64 || 0) / (1024 * 1024)),
        cpuPercent: typeof p.CPU === 'number' ? Math.round(p.CPU) : undefined,
      }));
      return { processes, count: processes.length };
    } else {
      // Linux / macOS
      const { stdout } = await execAsync(`ps -eo pid,%cpu,%mem,comm --sort=-%mem | head -n ${limit + 1}`, {
        timeout: 10000,
      });
      const lines = stdout.trim().split('\n').slice(1);
      const processes: ProcessItem[] = lines
        .map((l) => {
          const parts = l.trim().split(/\s+/);
          return {
            pid: Number.parseInt(parts[0] || '0', 10),
            cpuPercent: Number.parseFloat(parts[1] || '0'),
            memoryMb: Math.round(Number.parseFloat(parts[2] || '0')),
            name: parts.slice(3).join(' ') || 'unknown',
          };
        })
        .filter((p) => p.pid > 0);
      return { processes, count: processes.length };
    }
  } catch {
    return { processes: [], count: 0 };
  }
}
