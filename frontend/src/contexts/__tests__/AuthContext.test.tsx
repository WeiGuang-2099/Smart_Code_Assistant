import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider, useAuth } from '../AuthContext'
import { AUTH_LOGOUT, AUTH_TOKENS_UPDATED } from '../../lib/apiClient'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
)

const sampleUser = {
  id: 1,
  username: 'alice',
  email: 'alice@example.com',
  is_active: true,
  is_superuser: false,
}

function mockFetchOnce(response: Partial<Response>) {
  return vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  } as Response)
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthProvider initial state', () => {
  it('starts unauthenticated when localStorage is empty', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
  })

  it('restores user from localStorage when /me succeeds', async () => {
    localStorage.setItem('access_token', 'a-token')
    localStorage.setItem('refresh_token', 'r-token')
    localStorage.setItem('user', JSON.stringify(sampleUser))
    vi.stubGlobal('fetch', mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => sampleUser,
    }))

    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user?.username).toBe('alice')
  })

  it('clears auth when stored token is rejected and no refresh token', async () => {
    localStorage.setItem('access_token', 'bad-token')
    localStorage.setItem('user', JSON.stringify(sampleUser))
    vi.stubGlobal('fetch', mockFetchOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    }))

    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('access_token')).toBeNull()
  })
})

describe('login and logout', () => {
  it('login stores tokens and user in state and localStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.login('access-1', 'refresh-1', sampleUser)
    })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.token).toBe('access-1')
    expect(localStorage.getItem('access_token')).toBe('access-1')
    expect(localStorage.getItem('refresh_token')).toBe('refresh-1')
    expect(JSON.parse(localStorage.getItem('user') || '{}').username).toBe('alice')
  })

  it('logout clears state, even if the API call fails', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.login('a', 'r', sampleUser)
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')))

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})

describe('refreshAccessToken', () => {
  it('returns false when no refresh token is stored', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const ok = await act(async () => await result.current.refreshAccessToken())
    expect(ok).toBe(false)
  })

  it('persists new tokens on success', async () => {
    localStorage.setItem('refresh_token', 'old-refresh')
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh' }),
    } as Response))

    const ok = await act(async () => await result.current.refreshAccessToken())
    expect(ok).toBe(true)
    expect(localStorage.getItem('access_token')).toBe('new-access')
    expect(localStorage.getItem('refresh_token')).toBe('new-refresh')
  })

  it('returns false when the refresh endpoint rejects the token', async () => {
    localStorage.setItem('refresh_token', 'expired')
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response))

    const ok = await act(async () => await result.current.refreshAccessToken())
    expect(ok).toBe(false)
  })
})

describe('apiClient event integration', () => {
  it('clears the session when an auth:logout event fires', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.login('a', 'r', sampleUser)
    })
    expect(result.current.isAuthenticated).toBe(true)

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_LOGOUT))
    })

    await waitFor(() => expect(result.current.isAuthenticated).toBe(false))
    expect(result.current.token).toBeNull()
    expect(result.current.user).toBeNull()
  })

  it('updates the access token when an auth:tokens-updated event fires', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.login('a', 'r', sampleUser)
    })

    act(() => {
      window.dispatchEvent(
        new CustomEvent(AUTH_TOKENS_UPDATED, {
          detail: { access_token: 'rotated', refresh_token: 'rotated-r' },
        })
      )
    })

    await waitFor(() => expect(result.current.token).toBe('rotated'))
  })
})
