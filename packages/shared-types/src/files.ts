/**
 * Remote and Local File Management Types
 * Authoritative baseline defined in Master Specification §0.2, §11 (M8).
 */

export interface RemoteFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size_bytes: number;
  modified_at: string;
  permissions_mode: string;
  owner?: string | null | undefined;
  group?: string | null | undefined;
}

export interface FileContentResult {
  path: string;
  content: string;
  is_truncated: boolean;
  total_bytes: number;
  encoding: string;
}

export interface FileWriteResult {
  path: string;
  bytes_written: number;
  backup_path?: string | null | undefined;
}
