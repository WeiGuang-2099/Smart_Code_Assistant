import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { apiFetch } from '../lib/apiClient'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { agentService } from '../services/agentService'
import { useStreamChat } from '../hooks/useStreamChat'
import { StreamingText } from '../components/common/TypewriterText'
import { DynamicVirtualList } from '../components/common/VirtualList'
import type { AgentDetail, Message } from '../types/agent'


interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  codeBlocks?: { language: string; code: string }[]
}

export default function AgentChatPage() {
  const { id } = useParams<{ id: string }>()
  const { token, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streamingResponse, setStreamingResponse] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Streaming hook
  const { streamChat, isStreaming, cancel: cancelStream, retry, error: streamError } = useStreamChat()

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
    }
  }, [isAuthenticated, navigate])

  // Load agent data
  useEffect(() => {
    if (token && id) {
      loadAgent()
    }
  }, [token, id])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadAgent = async () => {
    if (!token || !id) return

    setLoading(true)
    setError('')

    try {
      const data = await agentService.getAgent(token, parseInt(id))
      setAgent(data)

      // Add welcome message
      setMessages([
        {
          role: 'assistant',
          content: `Hi! I'm **${data.name}**.\n\n${data.description || 'I can help you solve programming problems. What can I help you with?'}`,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent')
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || sending || !token) return

    const userMessage = input.trim()
    setInput('')
    setSending(true)

    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])

    try {
      // Build history for context
      const history = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const response = await apiFetch(`/api/v1/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: userMessage,
          history,
          language: 'python',
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()

      // Add assistant message
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.response,
          codeBlocks: data.code_blocks,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
      // Remove the user message on error
      setMessages((prev) => prev.slice(0, -1))
    } finally {
      setSending(false)
    }
  }

  // Streaming message send
  const sendStreamingMessage = async () => {
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')
    setStreamingResponse('')

    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])

    // Build history for context
    const history = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }))

    await streamChat(
      userMessage,
      history,
      (chunk) => {
        setStreamingResponse((prev) => prev + chunk)
      },
      {
        language: 'python',
        typewriterSpeed: 0,
        maxRetries: 3,
        retryDelay: 1000,
        onMetadata: (metadata) => {
          console.log('Stream metadata:', metadata)
        },
        onComplete: (fullResponse) => {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: fullResponse,
            },
          ])
          setStreamingResponse('')
        },
        onError: (error, recoverable) => {
          setError(`${error}${recoverable ? ' (will retry...)' : ''}`)
          if (!recoverable) {
            setMessages((prev) => prev.slice(0, -1))
          }
        },
      }
    )
  }

  const handleCancel = () => {
    cancelStream()
    if (streamingResponse) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: streamingResponse + '\n\n*[Response interrupted]*',
        },
      ])
      setStreamingResponse('')
    } else {
      setMessages((prev) => prev.slice(0, -1))
    }
  }

  const handleRetry = () => {
    setError('')
    retry()
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()
    if (lastUserMessage) {
      setInput(lastUserMessage.content)
      setMessages((prev) => prev.slice(0, -1))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendStreamingMessage()
    }
  }

  const renderContent = useCallback((content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g)

    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        const match = part.match(/```(\w*)\n?([\s\S]*?)```/)
        if (match) {
          const language = match[1] || 'code'
          const code = match[2]
          return (
            <pre key={index} className="bg-gray-900 rounded-lg p-4 my-2 overflow-x-auto border border-gray-700">
              <div className="text-xs text-gray-500 mb-2">{language}</div>
              <code className="text-sm text-gray-300 font-mono">{code}</code>
            </pre>
          )
        }
      }

      const inlineParts = part.split(/(`[^`]+`)/g)
      return (
        <span key={index}>
          {inlineParts.map((text, i) => {
            if (text.startsWith('`') && text.endsWith('`')) {
              return (
                <code key={i} className="bg-gray-800 px-1.5 py-0.5 rounded text-cyan-400 text-sm">
                  {text.slice(1, -1)}
                </code>
              )
            }
            return text.split('\n').map((line, j, arr) => (
              <span key={`${i}-${j}`}>
                {line.split(/\*\*([^*]+)\*\*/).map((part, k) =>
                  k % 2 === 1 ? <strong key={k}>{part}</strong> : part
                )}
                {j < arr.length - 1 && <br />}
              </span>
            ))
          })}
        </span>
      )
    })
  }, [])

  const renderMessage = useCallback((msg: ChatMessage, index: number) => (
    <div
      key={index}
      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}
    >
      <div
        className={`max-w-[80%] rounded-lg p-4 ${
          msg.role === 'user'
            ? 'bg-cyan-500/20 border border-cyan-500/30'
            : 'bg-gray-800/50 border border-gray-700'
        }`}
      >
        <div className="text-sm text-gray-300 leading-relaxed">{renderContent(msg.content)}</div>
      </div>
    </div>
  ), [renderContent])

  const memoizedMessages = useMemo(() => messages, [messages.length, messages[messages.length - 1]?.content])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin text-4xl neon-text">◌</div>
          <p className="text-gray-400 mt-4">Loading agent...</p>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="text-6xl mb-4 opacity-50">🤖</div>
          <h3 className="text-xl font-semibold text-red-400 mb-2">Agent Not Found</h3>
          <button onClick={() => navigate('/agents')} className="cyber-btn px-4 py-2 mt-4">
            Back to Agents
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/agents')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-xl
                        bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30"
          >
            {agent.avatar_url ? (
              <img src={agent.avatar_url} alt={agent.name} className="w-full h-full rounded-lg object-cover" />
            ) : (
              <span>🤖</span>
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100">{agent.name}</h1>
            {agent.domain && (
              <span className="text-xs text-purple-400 font-mono">{agent.domain}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/20">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-green-400">Online</span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 border border-red-500/50 rounded bg-red-500/10 flex justify-between items-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 hover:text-white">
            ×
          </button>
        </div>
      )}

      {/* Messages - Virtual scrolling for large lists */}
      {messages.length > 50 ? (
        <DynamicVirtualList
          items={memoizedMessages}
          estimatedItemHeight={100}
          containerHeight={400}
          renderItem={renderMessage}
          className="flex-1 mb-4 pr-2"
        />
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-4 ${
                  msg.role === 'user'
                    ? 'bg-cyan-500/20 border border-cyan-500/30'
                    : 'bg-gray-800/50 border border-gray-700'
                }`}
              >
                <div className="text-sm text-gray-300 leading-relaxed">{renderContent(msg.content)}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Streaming response indicator */}
      {isStreaming && streamingResponse && (
        <div className="flex justify-start mb-4">
          <div className="max-w-[80%] bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="text-sm text-gray-300 leading-relaxed">
              <StreamingText content={streamingResponse} isStreaming={isStreaming} />
            </div>
          </div>
        </div>
      )}

      {/* Loading indicator when no response yet */}
      {isStreaming && !streamingResponse && (
        <div className="flex justify-start mb-4">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-400">
              <div className="animate-spin">◌</div>
              <span className="text-sm">Thinking...</span>
            </div>
          </div>
        </div>
      )}

      {sending && !isStreaming && (
        <div className="flex justify-start mb-4">
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-400">
              <div className="animate-spin">◌</div>
              <span className="text-sm">Thinking...</span>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-700 pt-4">
        <div className="flex gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={isStreaming}
            rows={2}
            className="flex-1 px-4 py-3 bg-gray-900/50 border border-cyan-500/30 rounded-lg
                       text-gray-100 placeholder-gray-500 focus:border-cyan-500
                       focus:ring-2 focus:ring-cyan-500/20 transition-all resize-none"
          />
          <div className="flex flex-col gap-2">
            {isStreaming ? (
              <button
                onClick={handleCancel}
                className="px-6 py-3 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30
                           hover:bg-red-500/30 transition-all flex items-center gap-2"
              >
                <span>✕</span>
                <span>Cancel</span>
              </button>
            ) : (
              <button
                onClick={sendStreamingMessage}
                disabled={!input.trim()}
                className="px-6 py-3 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30
                           hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all flex items-center gap-2"
              >
                <span>Send</span>
                <span>→</span>
              </button>
            )}
            {streamError && (
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30
                           hover:bg-yellow-500/30 transition-all text-sm flex items-center gap-1"
              >
                <span>↻</span>
                <span>Retry</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-between items-center mt-2">
          <p className="text-xs text-gray-500">Press Enter to send, Shift+Enter for new line</p>
          {isStreaming && (
            <p className="text-xs text-cyan-400 animate-pulse">Streaming response...</p>
          )}
        </div>
      </div>
    </div>
  )
}
