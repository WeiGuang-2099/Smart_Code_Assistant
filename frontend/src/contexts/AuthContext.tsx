import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { AUTH_LOGOUT, AUTH_TOKENS_UPDATED } from '../lib/apiClient'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

interface User {
  id: number
  username: string
  email: string
  full_name?: string
  is_active: boolean
  is_superuser: boolean
}

interface AuthContextType {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  login: (accessToken: string, refreshToken: string, user: User) => void
  logout: () => Promise<void>
  refreshAccessToken: () => Promise<boolean>
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Refresh access token using refresh token
  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    const storedRefreshToken = localStorage.getItem('refresh_token')

    if (!storedRefreshToken) {
      return false
    }

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: storedRefreshToken }),
      })

      if (response.ok) {
        const data = await response.json()
        setToken(data.access_token)
        setRefreshToken(data.refresh_token)
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        return true
      } else {
        // Refresh token is invalid, clear everything
        console.error('Token refresh failed')
        return false
      }
    } catch (error) {
      console.error('Token refresh error:', error)
      return false
    }
  }, [])

  // Validate token and try to refresh if expired
  const validateToken = useCallback(async () => {
    const storedToken = localStorage.getItem('access_token')
    const storedRefreshToken = localStorage.getItem('refresh_token')
    const storedUser = localStorage.getItem('user')

    if (!storedToken || !storedUser) {
      setIsLoading(false)
      return
    }

    try {
      // Validate token by calling /auth/me endpoint
      const response = await fetch(`${API_URL}/api/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${storedToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        // Token is valid, restore user data
        setToken(storedToken)
        setRefreshToken(storedRefreshToken)
        setUser(JSON.parse(storedUser))
      } else if (response.status === 401 && storedRefreshToken) {
        // Token expired, try to refresh
        const refreshed = await refreshAccessToken()

        if (refreshed) {
          // Re-validate with new token
          const newToken = localStorage.getItem('access_token')
          if (newToken) {
            const retryResponse = await fetch(`${API_URL}/api/v1/auth/me`, {
              headers: {
                'Authorization': `Bearer ${newToken}`,
                'Content-Type': 'application/json',
              },
            })

            if (retryResponse.ok) {
              const userData = await retryResponse.json()
              setToken(newToken)
              setUser(userData)
              setRefreshToken(localStorage.getItem('refresh_token'))
            } else {
              // Still failed after refresh, clear data
              clearAuthData()
            }
          }
        } else {
          // Refresh failed, clear data
          clearAuthData()
        }
      } else {
        // Other error, clear data
        clearAuthData()
      }
    } catch (error) {
      console.error('Token validation error:', error)
      // On network error, keep user logged in if token exists
      if (storedToken && storedUser) {
        setToken(storedToken)
        setRefreshToken(storedRefreshToken)
        setUser(JSON.parse(storedUser))
      }
    }

    setIsLoading(false)
  }, [refreshAccessToken])

  // Clear auth data helper
  const clearAuthData = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
  }

  // Load auth state from localStorage on mount
  useEffect(() => {
    validateToken()
  }, [validateToken])

  // Sync React state with the central apiClient, which rotates/clears tokens in
  // localStorage during background 401 refresh-and-retry.
  useEffect(() => {
    const handleTokensUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ access_token: string; refresh_token: string }>).detail
      if (detail?.access_token) {
        setToken(detail.access_token)
        setRefreshToken(detail.refresh_token)
      }
    }

    const handleLogout = () => {
      setToken(null)
      setRefreshToken(null)
      setUser(null)
      clearAuthData()
    }

    window.addEventListener(AUTH_TOKENS_UPDATED, handleTokensUpdated)
    window.addEventListener(AUTH_LOGOUT, handleLogout)
    return () => {
      window.removeEventListener(AUTH_TOKENS_UPDATED, handleTokensUpdated)
      window.removeEventListener(AUTH_LOGOUT, handleLogout)
    }
  }, [])

  // Login function
  const login = (accessToken: string, newRefreshToken: string, newUser: User) => {
    setToken(accessToken)
    setRefreshToken(newRefreshToken)
    setUser(newUser)
    localStorage.setItem('access_token', accessToken)
    localStorage.setItem('refresh_token', newRefreshToken)
    localStorage.setItem('user', JSON.stringify(newUser))
  }

  // Logout function
  const logout = async () => {
    try {
      // Call logout endpoint to invalidate tokens on server
      if (token) {
        await fetch(`${API_URL}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      }
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      // Clear local state regardless of API call success
      setToken(null)
      setRefreshToken(null)
      setUser(null)
      clearAuthData()
    }
  }

  const value = {
    user,
    token,
    refreshToken,
    isAuthenticated: !!user && !!token,
    login,
    logout,
    refreshAccessToken,
    isLoading,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Helper hook to get API headers
export function useAuthHeaders() {
  const { token } = useAuth()

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}
