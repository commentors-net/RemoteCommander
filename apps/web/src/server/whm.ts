import https from 'node:https';
import { config } from './config.js';

export interface WhmAccount {
  user: string;
  domain: string;
  plan?: string;
  diskused?: string;
  disklimit?: string;
  suspended?: number | string;
  email?: string;
}

export interface WhmStatusResult {
  connected: boolean;
  version?: string;
  loadAverage?: string;
  accountsCount?: number;
  error?: string;
}

function doHttpsWhmRequest(
  method: 'GET' | 'POST',
  endpoint: string,
  paramsOrBody: Record<string, string> = {},
): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    if (!config.whmToken) {
      return reject(new Error('WHM API Token is not configured. Enter your token in Settings.'));
    }

    const host = config.whmHost || '127.0.0.1';
    const port = config.whmPort || 2087;

    let path = `/json-api/${endpoint}?api.version=1`;
    let postData = '';

    if (method === 'GET') {
      const query = new URLSearchParams(paramsOrBody).toString();
      if (query) path += `&${query}`;
    } else {
      postData = new URLSearchParams(paramsOrBody).toString();
    }

    const headers: Record<string, string | number> = {
      Authorization: `whm root:${config.whmToken.trim()}`,
      Accept: 'application/json',
      Host: `${host}:${port}`,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(
      {
        hostname: host,
        port,
        path,
        method,
        headers,
        rejectUnauthorized: false, // Critical: Ignore self-signed/loopback certs on cPanel port 2087
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode && res.statusCode >= 400) {
              const errMsg = parsed?.cpanelresult?.error || parsed?.metadata?.reason || `HTTP ${res.statusCode}`;
              reject(new Error(`WHM Error (${res.statusCode}): ${errMsg}`));
            } else {
              resolve({ statusCode: res.statusCode || 200, data: parsed });
            }
          } catch {
            if ((res.statusCode || 200) >= 400) {
              reject(new Error(`WHM HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            } else {
              resolve({ statusCode: res.statusCode || 200, data: body });
            }
          }
        });
      },
    );

    req.on('error', (err: any) => {
      let friendlyMsg = err.message;
      if (err.code === 'ECONNREFUSED') {
        friendlyMsg = `Connection refused at https://${host}:${port}. If testing locally from your PC, set WHM Host to your server domain (e.g. server.yourdomain.com). On cPanel, ensure WHM service is running.`;
      } else if (err.code === 'ETIMEDOUT') {
        friendlyMsg = `Connection timed out connecting to https://${host}:${port}. Check firewall or port 2087 accessibility.`;
      }
      reject(new Error(friendlyMsg));
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error(`WHM API request timed out after 15s (https://${host}:${port})`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function callWhmApi(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const res = await doHttpsWhmRequest('GET', endpoint, params);
  return res.data;
}

async function postWhmApi(endpoint: string, body: Record<string, string>): Promise<any> {
  const res = await doHttpsWhmRequest('POST', endpoint, body);
  return res.data;
}

export async function testWhmConnection(): Promise<WhmStatusResult> {
  if (!config.whmToken) {
    return {
      connected: false,
      error: 'No WHM API token configured.',
    };
  }

  try {
    const versionRes = await callWhmApi('version');
    const version = versionRes?.data?.version || 'Unknown';

    let accountsCount = 0;
    try {
      const acctsRes = await callWhmApi('listaccts', { want: 'user' });
      accountsCount = acctsRes?.data?.acct?.length || 0;
    } catch {
      // Non-fatal
    }

    return {
      connected: true,
      version,
      accountsCount,
    };
  } catch (err: any) {
    return {
      connected: false,
      error: err.message || 'Failed to connect to WHM API 1.',
    };
  }
}

export async function listWhmAccounts(): Promise<WhmAccount[]> {
  const res = await callWhmApi('listaccts', { want: 'user,domain,plan,diskused,disklimit,suspended,email' });
  const rawAccts = res?.data?.acct || [];
  return rawAccts.map((a: any) => ({
    user: a.user,
    domain: a.domain,
    plan: a.plan || 'default',
    diskused: a.diskused || '0M',
    disklimit: a.disklimit || 'unlimited',
    suspended: a.suspended,
    email: a.email || '',
  }));
}

export async function createWhmAccount(options: {
  username: string;
  domain: string;
  password?: string;
  plan?: string;
  contactEmail?: string;
}): Promise<{ success: boolean; message: string; raw?: any }> {
  const params: Record<string, string> = {
    username: options.username,
    domain: options.domain,
    plan: options.plan || 'default',
  };

  if (options.password) {
    params.password = options.password;
  }
  if (options.contactEmail) {
    params.contactemail = options.contactEmail;
  }

  const result = await postWhmApi('createacct', params);
  const metadata = result?.metadata || {};
  if (metadata.result === 1) {
    return {
      success: true,
      message: metadata.reason || 'Account created successfully.',
      raw: result.data,
    };
  }

  return {
    success: false,
    message: metadata.reason || 'Failed to create cPanel account.',
    raw: result,
  };
}

export async function getWhmServiceStatus(): Promise<any[]> {
  try {
    const res = await callWhmApi('servicestatus');
    return res?.data?.service || [];
  } catch {
    return [];
  }
}
