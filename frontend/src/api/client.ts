export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const API_BASE = '/lagersystem';

function readCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

async function ensureCsrf(): Promise<void> {
  if (readCookie('tms_csrf')) return;
  const res = await fetch(`${API_BASE}/api/auth/csrf`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, 'Sicherheits-Token konnte nicht geladen werden');
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    await ensureCsrf();
  }

  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = readCookie('tms_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    method,
    headers,
    credentials: 'include',
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      (body as { error?: string })?.error ??
      `Anfrage fehlgeschlagen (${res.status})`;
    throw new ApiError(res.status, message, (body as { details?: unknown })?.details);
  }

  return body as T;
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  await ensureCsrf();
  const headers = new Headers();
  const csrf = readCookie('tms_csrf');
  if (csrf) headers.set('X-CSRF-Token', csrf);

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'include',
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message =
      (body as { error?: string })?.error ?? `Anfrage fehlgeschlagen (${res.status})`;
    throw new ApiError(res.status, message, (body as { details?: unknown })?.details);
  }
  return body as T;
}

export function fileUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new ApiError(res.status, 'Download fehlgeschlagen');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Nicht sofort freigeben: Firefox/Safari brechen den Download ab, wenn die
  // Object-URL direkt nach dem Klick wieder verworfen wird.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Wie `downloadFile`, aber meldet Fehler statt ein unbehandeltes Promise
 * abzustoßen. Für Aufrufstellen, die ihren Fehler nicht selbst behandeln.
 */
export function downloadFileQuiet(path: string, filename: string, onError?: (msg: string) => void): void {
  void downloadFile(path, filename).catch((err: unknown) => {
    const message = err instanceof ApiError ? err.message : 'Download fehlgeschlagen';
    if (onError) onError(message);
    else console.error(message, err);
  });
}
