import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface FileItem {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  permissions: string;
}

function resolveSafePath(userPath: string): string {
  const root = path.resolve(config.websiteRoot);
  const normalized = path.normalize(userPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const target = path.resolve(root, normalized);
  if (!target.startsWith(root)) {
    throw new Error('Access denied: path traversal outside website root');
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
  if (targetPath === path.resolve(config.websiteRoot)) {
    throw new Error('Cannot delete website root directory');
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
