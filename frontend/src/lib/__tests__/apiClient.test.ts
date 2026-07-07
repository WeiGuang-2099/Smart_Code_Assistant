import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, AUTH_LOGOUT, AUTH_TOKENS_UPDATED } from '../apiClient'

const API = 'http://localhost:8000'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

/**
 * Build a fetch mock that routes by URL substring. Each route is a queue of
 * responses consumed in order, so we can model "401 then 200 after refresh".
 */
function routedFetch(routes: Record<string, Response[]>) {
  const calls: Record<string, number> = {}
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        calls[key] = (calls[key] ?? 0) + 1
        const queue = routes[key]
        return queue.length > 1 ? queue.shift()! : queue[0]
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  return { fn, calls }
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch auth header injection', () => {
  it('adds the bearer token from localStorage', async () => {
    localStorage.setItem('access_token', 'live-token')
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/v1/projects')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer live-token')
  })

  it('prefixes a relative path with the API base url', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/api/v1/projects')

    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/api/v1/projects`)
  })
})

describe('apiFetch 401 refresh-and-retry', () => {
  it('refreshes the token then retries the original request', async () => {
    localStorage.setItem('access_token', 'expired')
    localStorage.setItem('refresh_token', 'r-token')

    const { fn, calls } = routedFetch({
      '/api/v1/projects': [jsonResponse(401, { detail: 'expired' }), jsonResponse(200, { projects: [] })],
      '/api/v1/auth/refresh': [jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh' })],
    })
    vi.stubGlobal('fetch', fn)

    const res = await apiFetch('/api/v1/projects')

    expect(res.status).toBe(200)
    expect(calls['/api/v1/auth/refresh']).toBe(1)
    expect(calls['/api/v1/projects']).toBe(2) // original + retry
    expect(localStorage.getItem('access_token')).toBe('new-access')
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh')
  })

  it('sends the refreshed token on the retried request', async () => {
    localStorage.setItem('access_token', 'expired')
    localStorage.setItem('refresh_token', 'r-token')

    const { fn } = routedFetch({
      '/api/v1/projects': [jsonResponse(401, {}), jsonResponse(200, {})],
      '/api/v1/auth/refresh': [jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh' })],
    })
    vi.stubGlobal('fetch', fn)

    await apiFetch('/api/v1/projects')

    const retryInit = fn.mock.calls.find(
      (c, i) => (c[0] as string).includes('/projects') && i > 0
    )?.[1] as RequestInit
    expect(new Headers(retryInit.headers).get('Authorization')).toBe('Bearer new-access')
  })

  it('dispatches a tokens-updated event after a successful refresh', async () => {
    localStorage.setItem('access_token', 'expired')
    localStorage.setItem('refresh_token', 'r-token')
    const { fn } = routedFetch({
      '/api/v1/projects': [jsonResponse(401, {}), jsonResponse(200, {})],
      '/api/v1/auth/refresh': [jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh' })],
    })
    vi.stubGlobal('fetch', fn)
    const listener = vi.fn()
    window.addEventListener(AUTH_TOKENS_UPDATED, listener)

    await apiFetch('/api/v1/projects')

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(AUTH_TOKENS_UPDATED, listener)
  })
})

describe('apiFetch concurrent 401s', () => {
  it('refreshes only once for simultaneous failures', async () => {
    localStorage.setItem('access_token', 'expired')
    localStorage.setItem('refresh_token', 'r-token')

    const { fn, calls } = routedFetch({
      '/api/v1/projects': [jsonResponse(401, {}), jsonResponse(200, {})],
      '/api/v1/agents': [jsonResponse(401, {}), jsonResponse(200, {})],
      '/api/v1/auth/refresh': [jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh' })],
    })
    vi.stubGlobal('fetch', fn)

    const [a, b] = await Promise.all([apiFetch('/api/v1/projects'), apiFetch('/api/v1/agents')])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(calls['/api/v1/auth/refresh']).toBe(1)
  })
})

describe('apiFetch refresh failure', () => {
  it('dispatches logout and clears tokens when refresh fails', async () => {
    localStorage.setItem('access_token', 'expired')
    localStorage.setItem('refresh_token', 'bad-refresh')

    const { fn } = routedFetch({
      '/api/v1/projects': [jsonResponse(401, {})],
      '/api/v1/auth/refresh': [jsonResponse(401, { detail: 'invalid refresh' })],
    })
    vi.stubGlobal('fetch', fn)
    const logout = vi.fn()
    window.addEventListener(AUTH_LOGOUT, logout)

    const res = await apiFetch('/api/v1/projects')

    expect(res.status).toBe(401)
    expect(logout).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
    window.removeEventListener(AUTH_LOGOUT, logout)
  })

  it('does not attempt a refresh when there is no refresh token', async () => {
    localStorage.setItem('access_token', 'expired')
    const { fn, calls } = routedFetch({
      '/api/v1/projects': [jsonResponse(401, {})],
    })
    vi.stubGlobal('fetch', fn)

    const res = await apiFetch('/api/v1/projects')

    expect(res.status).toBe(401)
    expect(calls['/api/v1/auth/refresh']).toBeUndefined()
  })
})

describe('apiFetch auth endpoints', () => {
  it('does not refresh-loop on a 401 from an auth endpoint', async () => {
    localStorage.setItem('refresh_token', 'r-token')
    const { fn, calls } = routedFetch({
      '/api/v1/auth/login': [jsonResponse(401, { detail: 'bad creds' })],
    })
    vi.stubGlobal('fetch', fn)

    const res = await apiFetch('/api/v1/auth/login', { method: 'POST' })

    expect(res.status).toBe(401)
    expect(calls['/api/v1/auth/refresh']).toBeUndefined()
  })
})
