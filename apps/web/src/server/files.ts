import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const execFileAsync = promisify(execFile);

export interface FileItem {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  permissions: string;
}

export function getAllowedRoots(): string[] {
  const roots: string[] = [];
  if (config.websiteRoot) {
    roots.push(path.resolve(config.websiteRoot));
  }
  const home = os.homedir();
  if (home && home !== '/' && home !== '\\') {
    const resolvedHome = path.resolve(home);
    if (!roots.includes(resolvedHome)) {
      roots.push(resolvedHome);
    }
  }
  return roots;
}

export interface PathAccessErrorDetails {
  cleanPath: string;
  target: string;
  reason: string;
  resolution: string;
}

export function getPathAccessDeniedDetails(
  cleanPath: string,
  target: string,
  allowedRoots: string[]
): PathAccessErrorDetails {
  const normalized = cleanPath.replace(/\\/g, '/');
  const allowedDesc = allowedRoots.join(', ');

  // 1. System Apache, Passenger, Nginx, or Web Server configurations
  if (
    normalized.startsWith('/etc/apache2') ||
    normalized.startsWith('/etc/httpd') ||
    normalized.startsWith('/etc/nginx') ||
    normalized.startsWith('/etc/cpanel') ||
    normalized.startsWith('/var/cpanel') ||
    normalized.includes('conf/httpd.conf') ||
    normalized.includes('vhost')
  ) {
    return {
      cleanPath,
      target,
      reason: `Path "${cleanPath}" is a global server daemon configuration file owned by root:root outside your hosting account sandbox.`,
      resolution: `For web routing, subfolder URLs (such as /commander), or Phusion Passenger directives, inspect your account's local .htaccess file (e.g. "public_html/.htaccess" or "public_html/commander/.htaccess") or application settings ("package.json", ".env"). To modify server-wide virtual hosts, use SSH terminal with root/sudo or WHM > Service Configuration > Apache Configuration.`,
    };
  }

  // 2. Sensitive Operating System files / Root directories
  if (
    normalized.startsWith('/etc/shadow') ||
    normalized.startsWith('/etc/passwd') ||
    normalized.startsWith('/etc/sudoers') ||
    normalized.startsWith('/root') ||
    normalized.startsWith('C:/Windows') ||
    normalized.startsWith('C:/Program Files')
  ) {
    return {
      cleanPath,
      target,
      reason: `Path "${cleanPath}" is a protected operating system system path. Access is restricted to prevent system privilege escalation.`,
      resolution: `Operating system administrative tasks require SSH or cPanel Terminal access with appropriate root privileges. The web agent cannot access OS-level files.`,
    };
  }

  // 3. System Logs
  if (normalized.startsWith('/var/log')) {
    return {
      cleanPath,
      target,
      reason: `Path "${cleanPath}" is a server-wide system log directory outside your account.`,
      resolution: `Account-level errors are logged in "public_html/error_log" or your Node app directory (e.g. "~/.npm/_logs"). Inspect those files instead, or view system logs via WHM/SSH.`,
    };
  }

  // 4. Another user's home directory
  if (normalized.startsWith('/home/') && !allowedRoots.some((r) => target.startsWith(r))) {
    return {
      cleanPath,
      target,
      reason: `Path "${cleanPath}" resides in another user account on this server. Linux tenant isolation strictly forbids cross-account access.`,
      resolution: `You can only access files within your own hosting account (${allowedDesc}). Ensure the path points to your own user directory.`,
    };
  }

  // 5. Directory Traversal Attempts
  if (cleanPath.includes('..')) {
    return {
      cleanPath,
      target,
      reason: `Path "${cleanPath}" uses directory traversal ("..") that attempts to escape outside your allowed account boundaries.`,
      resolution: `Specify paths relative to your website root ("public_html/...") or within your home folder without navigating above the account root.`,
    };
  }

  // 6. Generic outside path
  return {
    cleanPath,
    target,
    reason: `Path "${cleanPath}" resolves to "${target}", which is outside your allowed account boundaries (${allowedDesc}).`,
    resolution: `Files must be placed inside your website document root (${allowedRoots[0] || 'public_html'}) or your account home directory (${allowedRoots[1] || 'home'}).`,
  };
}

export function resolveSafePath(userPath: string): string {
  const allowedRoots = getAllowedRoots();
  const primaryRoot = allowedRoots[0] || path.resolve(process.cwd());

  let target: string;
  const cleanPath = (userPath || '').trim();

  if (path.isAbsolute(cleanPath)) {
    target = path.normalize(cleanPath);
  } else {
    let rel = cleanPath;
    // If primaryRoot ends with 'public_html' and rel starts with 'public_html', avoid public_html/public_html
    if (
      primaryRoot.endsWith('public_html') &&
      (rel === 'public_html' || rel.startsWith('public_html/') || rel.startsWith('public_html\\'))
    ) {
      rel = rel.replace(/^public_html[\/\\]?/, '');
    }
    target = path.resolve(primaryRoot, rel);
  }

  // Ensure target doesn't point to system root or outside allowed roots
  const isAllowed = allowedRoots.some((root) => {
    return (
      target === root ||
      target.startsWith(root + path.sep) ||
      (path.sep === '/' && target.startsWith(root + '/'))
    );
  });

  if (!isAllowed) {
    const details = getPathAccessDeniedDetails(cleanPath, target, allowedRoots);
    const err = new Error(
      `Access denied: path "${cleanPath}" is outside allowed roots (${allowedRoots.join(', ')}).\nWhy: ${details.reason}\nResolution: ${details.resolution}`
    ) as any;
    err.code = 'ERR_ACCESS_DENIED';
    err.details = details;
    throw err;
  }

  return target;
}

export async function listDirectory(relativeSubdir = ''): Promise<{ files: FileItem[]; currentPath: string }> {
  const targetDir = resolveSafePath(relativeSubdir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
  const items: FileItem[] = [];

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      items.push({
        name: entry.name,
        relativePath: path.relative(config.websiteRoot, fullPath).replace(/\\/g, '/'),
        isDirectory: entry.isDirectory(),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        permissions: (stat.mode & 0o777).toString(8),
      });
    } catch {
      // Skip unreadable files
    }
  }

  // Sort directories first, then alphabetical
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    files: items,
    currentPath: path.relative(config.websiteRoot, targetDir).replace(/\\/g, '/') || '/',
  };
}

export async function readFileContent(relativeFilePath: string): Promise<{ content: string; sizeBytes: number }> {
  const targetPath = resolveSafePath(relativeFilePath);
  const stat = await fs.promises.stat(targetPath);
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error('File exceeds maximum readable size (2MB)');
  }
  const content = await fs.promises.readFile(targetPath, 'utf-8');
  return { content, sizeBytes: stat.size };
}

export async function writeFileContent(relativeFilePath: string, content: string): Promise<{ success: boolean; bytesWritten: number }> {
  const targetPath = resolveSafePath(relativeFilePath);
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // Create backup if file exists
  if (fs.existsSync(targetPath)) {
    const backupPath = `${targetPath}.bak.${Date.now()}`;
    await fs.promises.copyFile(targetPath, backupPath);
  }

  await fs.promises.writeFile(targetPath, content, 'utf-8');
  const stat = await fs.promises.stat(targetPath);
  return { success: true, bytesWritten: stat.size };
}

export async function deleteFileOrDirectory(relativeTarget: string): Promise<boolean> {
  const targetPath = resolveSafePath(relativeTarget);
  const allowedRoots = getAllowedRoots();
  if (allowedRoots.includes(targetPath)) {
    throw new Error('Cannot delete root directory');
  }
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const stat = await fs.promises.stat(targetPath);
  if (stat.isDirectory()) {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  } else {
    await fs.promises.unlink(targetPath);
  }
  return true;
}

export async function extractArchive(
  archivePath: string,
  destination = ''
): Promise<{ success: boolean; extractedTo: string; message: string }> {
  const safeArchivePath = resolveSafePath(archivePath);
  if (!fs.existsSync(safeArchivePath)) {
    throw new Error(`Archive file not found: ${archivePath}`);
  }

  const stat = await fs.promises.stat(safeArchivePath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not an archive file: ${archivePath}`);
  }

  const safeDestDir = resolveSafePath(destination || '');
  if (!fs.existsSync(safeDestDir)) {
    await fs.promises.mkdir(safeDestDir, { recursive: true });
  }

  try {
    await execFileAsync('tar', ['-xf', safeArchivePath, '-C', safeDestDir]);
    return {
      success: true,
      extractedTo: safeDestDir,
      message: `Successfully extracted ${path.basename(safeArchivePath)} into ${safeDestDir}`,
    };
  } catch (tarErr: any) {
    try {
      await execFileAsync('unzip', ['-o', safeArchivePath, '-d', safeDestDir]);
      return {
        success: true,
        extractedTo: safeDestDir,
        message: `Successfully extracted ${path.basename(safeArchivePath)} into ${safeDestDir}`,
      };
    } catch (unzipErr: any) {
      throw new Error(`Failed to extract archive: ${tarErr.message || unzipErr.message}`);
    }
  }
}

