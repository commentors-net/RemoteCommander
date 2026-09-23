export function getAuthToken(): string {
  return localStorage.getItem('rc_web_token') || '';
}

export function setAuthToken(token: string): void {
  localStorage.setItem('rc_web_token', token);
}

export function clearAuthToken(): void {
  localStorage.removeItem('rc_web_token');
}

export function resolveApiEndpoint(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const match = pathname.match(/^(\/[^/]+)/);
  if (match && match[1] === '/commander') {
    return `${match[1]}${clean}`;
  }
  return clean;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const targetUrl = resolveApiEndpoint(endpoint);
  const response = await fetch(targetUrl, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAuthToken();
    window.dispatchEvent(new Event('rc-auth-required'));
    throw new Error('Authentication required');
  }

  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `HTTP error ${response.status}`);
  }

  return data;
}
