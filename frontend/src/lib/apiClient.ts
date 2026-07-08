/**
 * Central API client with automatic 401 -> token refresh -> retry.
 *
 * Every authenticated request in the app should go through `apiFetch`. When the
 * backend rejects an access token with 401, the client transparently uses the
 * stored refresh token to obtain a new access token (once, even under
 * concurrent failures) and replays the original request. If the refresh itself
 * fails, stored auth is cleared and an `auth:logout` event is emitted so the
 * AuthContext can drop the session and redirect to login.
 *
 * localStorage is the single source of truth for tokens, shared with
 * AuthContext. The client dispatches DOM events instead of importing React so
 * it can be used from plain modules (services) and components alike.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const ACCESS_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'
const USER_KEY = 'user'

/** Fired after the access/refresh tokens are rotated by a successful refresh. */
export const AUTH_TOKENS_UPDATED = 'auth:tokens-updated'
/** Fired when the session is no longer valid and the user must re-authenticate. */
export const AUTH_LOGOUT = 'auth:logout'

/** Single in-flight refresh shared across concurrent 401s. */
let refreshPromise: Promise<boolean> | null = null

function buildUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_URL}${path}`
}

/** Clone request init and stamp the current access token onto the headers. */
function withAuth(options: RequestInit): RequestInit {
  const headers = new Headers(options.headers || {})
  const token = localStorage.getItem(ACCESS_KEY)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return { ...options, headers }
}

async function performRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) return false

  try {
    const res = await fetch(buildUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return false

    const data = await res.json()
    localStorage.setItem(ACCESS_KEY, data.access_token)
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    window.dispatchEvent(
      new CustomEvent(AUTH_TOKENS_UPDATED, {
        detail: { access_token: data.access_token, refresh_token: data.refresh_token },
      })
    )
    return true
  } catch {
    return false
  }
}

function refreshTokens(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function clearAuthAndNotify(): void {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
  window.dispatchEvent(new CustomEvent(AUTH_LOGOUT))
}

/**
 * Drop-in replacement for `fetch` for backend calls. Accepts a relative path
 * (e.g. `/api/v1/projects`) or an absolute URL, injects the bearer token, and
 * handles 401 refresh-and-retry.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = buildUrl(path)
  const isAuthEndpoint = path.includes('/auth/')

  let response = await fetch(url, withAuth(options))

  if (response.status === 401 && !isAuthEndpoint) {
    const refreshed = await refreshTokens()
    if (refreshed) {
      response = await fetch(url, withAuth(options))
    } else {
      clearAuthAndNotify()
    }
  }

  return response
}
