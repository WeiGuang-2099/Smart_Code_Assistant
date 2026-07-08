import { useState, useCallback, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/apiClient'

interface UseAsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

interface UseAsyncOptions<T> {
  immediate?: boolean
  initialData?: T
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
  retryCount?: number
  retryDelay?: number
}

interface UseAsyncReturn<T> extends UseAsyncState<T> {
  execute: (...args: unknown[]) => Promise<T | null>
  reset: () => void
  retry: () => Promise<T | null>
  setData: (data: T) => void
  setError: (error: Error) => void
  isRetrying: boolean
  retryAttempt: number
}

/**
 * Hook for async operations with loading, error states, and retry support
 */
export function useAsync<T>(
  asyncFunction: (...args: unknown[]) => Promise<T>,
  options: UseAsyncOptions<T> = {}
): UseAsyncReturn<T> {
  const {
    immediate = false,
    initialData = null,
    onSuccess,
    onError,
    retryCount = 3,
    retryDelay = 1000,
  } = options

  const [state, setState] = useState<UseAsyncState<T>>({
    data: initialData as T | null,
    loading: immediate,
    error: null,
  })

  const [isRetrying, setIsRetrying] = useState(false)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const mountedRef = useRef(true)
  const argsRef = useRef<unknown[]>([])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const execute = useCallback(
    async (...args: unknown[]): Promise<T | null> => {
      argsRef.current = args
      setState((prev) => ({ ...prev, loading: true, error: null }))
      setRetryAttempt(0)

      try {
        const result = await asyncFunction(...args)
        if (mountedRef.current) {
          setState({ data: result, loading: false, error: null })
          onSuccess?.(result)
        }
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, loading: false, error: err }))
          onError?.(err)
        }
        return null
      }
    },
    [asyncFunction, onSuccess, onError]
  )

  const retry = useCallback(async (): Promise<T | null> => {
    setIsRetrying(true)
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      if (!mountedRef.current) break

      setRetryAttempt(attempt)
      setState((prev) => ({ ...prev, loading: true, error: null }))

      try {
        const result = await asyncFunction(...argsRef.current)
        if (mountedRef.current) {
          setState({ data: result, loading: false, error: null })
          setIsRetrying(false)
          setRetryAttempt(0)
          onSuccess?.(result)
        }
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < retryCount && mountedRef.current) {
          // Wait before next retry
          await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt))
        }
      }
    }

    // All retries failed
    if (mountedRef.current) {
      setState((prev) => ({ ...prev, loading: false, error: lastError }))
      setIsRetrying(false)
      if (lastError) {
        onError?.(lastError)
      }
    }
    return null
  }, [asyncFunction, retryCount, retryDelay, onSuccess, onError])

  const reset = useCallback(() => {
    setState({ data: initialData as T | null, loading: false, error: null })
    setIsRetrying(false)
    setRetryAttempt(0)
  }, [initialData])

  const setData = useCallback((data: T) => {
    setState((prev) => ({ ...prev, data }))
  }, [])

  const setError = useCallback((error: Error) => {
    setState((prev) => ({ ...prev, error, loading: false }))
  }, [])

  // Execute immediately if requested
  useEffect(() => {
    if (immediate) {
      execute()
    }
  }, [immediate, execute])

  return {
    ...state,
    execute,
    reset,
    retry,
    setData,
    setError,
    isRetrying,
    retryAttempt,
  }
}

/**
 * Hook for fetching data with automatic refresh
 */
interface UseFetchOptions<T> extends UseAsyncOptions<T> {
  refreshInterval?: number
  refreshOnFocus?: boolean
}

export function useFetch<T>(
  url: string,
  options: UseFetchOptions<T> = {}
): UseAsyncReturn<T> & { refresh: () => Promise<T | null> } {
  const { refreshInterval, refreshOnFocus = false, ...asyncOptions } = options

  const fetchFunction = useCallback(async () => {
    const response = await apiFetch(url, {
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || errorData.detail || `HTTP ${response.status}`)
    }

    return response.json()
  }, [url])

  const asyncReturn = useAsync(fetchFunction, { immediate: true, ...asyncOptions })

  // Refresh interval
  useEffect(() => {
    if (!refreshInterval) return

    const interval = setInterval(() => {
      asyncReturn.execute()
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [refreshInterval, asyncReturn])

  // Refresh on window focus
  useEffect(() => {
    if (!refreshOnFocus) return

    const handleFocus = () => {
      asyncReturn.execute()
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refreshOnFocus, asyncReturn])

  return {
    ...asyncReturn,
    refresh: asyncReturn.execute,
  }
}

/**
 * Hook for online/offline detection
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}

/**
 * Hook for debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

/**
 * Hook for intersection observer (lazy loading)
 */
export function useIntersectionObserver(
  ref: React.RefObject<Element>,
  options?: IntersectionObserverInit
): boolean {
  const [isIntersecting, setIsIntersecting] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting)
    }, options)

    observer.observe(element)

    return () => observer.disconnect()
  }, [ref, options])

  return isIntersecting
}
