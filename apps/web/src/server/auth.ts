import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

// In-memory active tokens map
const activeTokens = new Set<string>();

export function generateSessionToken(password: string): string | null {
  if (!config.adminPassword || password !== config.adminPassword) {
    return null;
  }

  const token = crypto.randomBytes(32).toString('hex');
  activeTokens.add(token);
  return token;
}

export function revokeToken(token: string): void {
  activeTokens.delete(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // If no password configured, pass through (e.g. initial setup)
  if (!config.adminPassword) {
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || (req.query.token as string);

  if (token && activeTokens.has(token)) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized: valid bearer token required' });
}
