/**
 * useStreamChat - Enhanced Hook for streaming chat responses via SSE
 *
 * Features:
 * - Real-time content streaming with typed events
 * - Automatic reconnection with Last-Event-ID
 * - Typewriter effect for smooth text display
 * - Heartbeat handling for connection keep-alive
 * - Comprehensive error handling with retry support
 *
 * Usage:
 * const { streamChat, isStreaming, error, cancel, retry } = useStreamChat()
 * await streamChat(message, history, (chunk) => setResponse(prev => prev + chunk))
 */
import { useState, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../contexts/AuthContext'


type StreamEventType = 'content' | 'error' | 'done' | 'heartbeat' | 'metadata' | 'tool_start' | 'tool_end'

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface StreamMetadata {
  session_id: string
  code_blocks_detected?: number
  language?: string
}

export interface StreamChatOptions {
  language?: string
  typewriterSpeed?: number
  maxRetries?: number
  retryDelay?: number
  onMetadata?: (metadata: StreamMetadata) => void
  onError?: (error: string, recoverable: boolean) => void
  onComplete?: (fullResponse: string) => void
  onTypewriter?: (char: string) => void
}

interface StreamState {
  sessionId: string | null
  lastEventId: string | null
  metadata: StreamMetadata | null
  retryCount: number
}

export const useStreamChat = () => {
  const { token } = useAuth()
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<StreamState>({
    sessionId: null,
    lastEventId: null,
    metadata: null,
    retryCount: 0,
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const typewriterTimeoutRef = useRef<number | null>(null)
  const typewriterQueueRef = useRef<string[]>([])
  const fullResponseRef = useRef<string>('')

  const processTypewriterQueue = useCallback(
    (onChunk: (chunk: string) => void, speed: number) => {
      if (typewriterQueueRef.current.length === 0) {
        typewriterTimeoutRef.current = null
        return
      }

      const char = typewriterQueueRef.current.shift()
      if (char) {
        onChunk(char)
        fullResponseRef.current += char
      }

      typewriterTimeoutRef.current = window.setTimeout(() => {
        processTypewriterQueue(onChunk, speed)
      }, speed)
    },
    []
  )

  const addToTypewriterQueue = useCallback(
    (text: string, onChunk: (chunk: string) => void, speed: number) => {
      const chars = text.split('')
      typewriterQueueRef.current.push(...chars)

      if (!typewriterTimeoutRef.current) {
        processTypewriterQueue(onChunk, speed)
      }
    },
    [processTypewriterQueue]
  )

  const flushTypewriterQueue = useCallback(() => {
    if (typewriterTimeoutRef.current) {
      clearTimeout(typewriterTimeoutRef.current)
      typewriterTimeoutRef.current = null
    }
    typewriterQueueRef.current = []
  }, [])

  const parseSSEEvent = (line: string): { event: string; data: string; id?: string } | null => {
    const eventMatch = line.match(/^event:\s*(.+)$/)
    const dataMatch = line.match(/^data:\s*(.+)$/)
    const idMatch = line.match(/^id:\s*(.+)$/)

    if (eventMatch) {
      return { event: eventMatch[1], data: '', id: undefined }
    }
    if (dataMatch) {
      return { event: '', data: dataMatch[1], id: idMatch?.[1] }
    }
    return null
  }

  const streamChat = useCallback(
    async (
      message: string,
      history: Message[],
      onChunk: (chunk: string) => void,
      options: StreamChatOptions = {}
    ): Promise<void> => {
      if (!token) {
        setError('Not authenticated')
        return
      }

      const {
        language = 'python',
        typewriterSpeed = 0,
        maxRetries = 3,
        retryDelay = 1000,
        onMetadata,
        onError,
        onComplete,
        onTypewriter,
      } = options

      setIsStreaming(true)
      setError(null)
      fullResponseRef.current = ''
      flushTypewriterQueue()

      abortControllerRef.current = new AbortController()

      const attemptStream = async (retryCount: number): Promise<void> => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }

        if (state.lastEventId) {
          headers['Last-Event-ID'] = state.lastEventId
        }

        try {
          const response = await apiFetch(`/api/v1/agent/chat/stream`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message,
              history,
              language,
            }),
            signal: abortControllerRef.current!.signal,
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error('Response body is not readable')
          }

          const decoder = new TextDecoder()
          let buffer = ''
          let currentEvent = 'content'
          let currentData = ''
          let currentId: string | undefined

          setState((prev) => ({ ...prev, retryCount }))

          while (true) {
            const { done, value } = await reader.read()

            if (done) break

            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.trim()) {
                if (currentData) {
                  try {
                    const parsed = JSON.parse(currentData)

                    switch (currentEvent as StreamEventType) {
                      case 'content':
                        if (parsed.content) {
                          if (typewriterSpeed > 0) {
                            addToTypewriterQueue(parsed.content, onChunk, typewriterSpeed)
                          } else {
                            onChunk(parsed.content)
                            fullResponseRef.current += parsed.content
                          }
                        }
                        break

                      case 'metadata':
                        setState((prev) => ({
                          ...prev,
                          sessionId: parsed.session_id,
                          metadata: parsed,
                        }))
                        onMetadata?.(parsed)
                        break

                      case 'error':
                        const recoverable = parsed.recoverable ?? false
                        if (recoverable && retryCount < maxRetries) {
                          console.log(`Retrying stream (attempt ${retryCount + 1})...`)
                          await new Promise((r) => setTimeout(r, retryDelay))
                          return attemptStream(retryCount + 1)
                        }
                        throw new Error(parsed.error)

                      case 'done':
                        flushTypewriterQueue()
                        const finalResponse = fullResponseRef.current
                        onComplete?.(finalResponse)
                        return

                      case 'heartbeat':
                        break
                    }
                  } catch (parseError) {
                    if (currentData === '[DONE]') {
                      flushTypewriterQueue()
                      onComplete?.(fullResponseRef.current)
                      return
                    }
                    console.warn('Failed to parse SSE data:', currentData)
                  }
                  currentData = ''
                }
                continue
              }

              const parsed = parseSSEEvent(line)
              if (parsed) {
                if (parsed.event) {
                  currentEvent = parsed.event
                }
                if (parsed.data) {
                  currentData = parsed.data
                }
                if (parsed.id) {
                  currentId = parsed.id
                  setState((prev) => ({ ...prev, lastEventId: parsed.id ?? null }))
                }
              } else if (line.startsWith('data: ')) {
                currentData = line.slice(6).trim()
              }
            }
          }

          flushTypewriterQueue()
          onComplete?.(fullResponseRef.current)
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            console.log('Stream cancelled by user')
            flushTypewriterQueue()
            return
          }

          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          const isRecoverable = retryCount < maxRetries

          if (isRecoverable) {
            console.log(`Retrying stream after error (attempt ${retryCount + 1})...`)
            await new Promise((r) => setTimeout(r, retryDelay))
            return attemptStream(retryCount + 1)
          }

          setError(errorMessage)
          onError?.(errorMessage, false)
          console.error('Stream error:', err)
        }
      }

      try {
        await attemptStream(0)
      } finally {
        setIsStreaming(false)
        abortControllerRef.current = null
      }
    },
    [token, state.lastEventId, addToTypewriterQueue, flushTypewriterQueue]
  )

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    flushTypewriterQueue()
    setIsStreaming(false)
    setError('Cancelled by user')
  }, [flushTypewriterQueue])

  const retry = useCallback(() => {
    setError(null)
    setState((prev) => ({
      ...prev,
      retryCount: 0,
      lastEventId: null,
    }))
  }, [])

  const reset = useCallback(() => {
    setError(null)
    setState({
      sessionId: null,
      lastEventId: null,
      metadata: null,
      retryCount: 0,
    })
    fullResponseRef.current = ''
    flushTypewriterQueue()
  }, [flushTypewriterQueue])

  return {
    streamChat,
    isStreaming,
    error,
    cancel,
    retry,
    reset,
    sessionId: state.sessionId,
    metadata: state.metadata,
    retryCount: state.retryCount,
  }
}

export default useStreamChat
