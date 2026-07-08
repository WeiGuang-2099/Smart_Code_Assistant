import { useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../contexts/AuthContext'
import CodeEditor from '../components/Editor'

const LANGUAGE_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'cpp', label: 'C++' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
]

const PRESET_PROMPTS = [
  { label: 'Create a function', prompt: 'Create a function that sorts an array of integers in ascending order' },
  { label: 'API endpoint', prompt: 'Create a REST API endpoint for user authentication with JWT' },
  { label: 'Data class', prompt: 'Create a data class for representing a user with name, email, and age' },
  { label: 'Async function', prompt: 'Create an async function to fetch data from an API with error handling' },
  { label: 'Algorithm', prompt: 'Implement a binary search algorithm' },
  { label: 'Custom hook', prompt: 'Create a React custom hook for managing form state' },
]

export default function CodeGenPage() {
  const { isAuthenticated, token } = useAuth()
  const [mode, setMode] = useState<'generate' | 'review' | 'chat'>('generate')
  const [language, setLanguage] = useState('python')
  const [prompt, setPrompt] = useState('')
  const [context, setContext] = useState('')
  const [generatedCode, setGeneratedCode] = useState('')
  const [explanation, setExplanation] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Code review state
  const [reviewCode, setReviewCode] = useState('')
  const [reviewResult, setReviewResult] = useState<any>(null)

  // Chat state
  const [chatMessages, setChatMessages] = useState<Array<{role: string, content: string}>>([])
  const [chatInput, setChatInput] = useState('')

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showMessage('Please enter a prompt', 'error')
      return
    }

    setLoading(true)
    setGeneratedCode('')
    setExplanation('')

    try {
      const response = await apiFetch(`/api/v1/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt,
          language,
          context: context || undefined,
        }),
      })

      if (!response.ok) {
        throw new Error('Generation failed')
      }

      const data = await response.json()
      setGeneratedCode(data.code)
      setExplanation(data.explanation || '')
      showMessage('Code generated successfully!', 'success')
    } catch (err) {
      console.error(err)
      showMessage('Failed to generate code', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleReview = async () => {
    if (!reviewCode.trim()) {
      showMessage('Please enter code to review', 'error')
      return
    }

    setLoading(true)
    setReviewResult(null)

    try {
      const response = await apiFetch(`/api/v1/ai/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          code: reviewCode,
          language,
        }),
      })

      if (!response.ok) {
        throw new Error('Review failed')
      }

      const data = await response.json()
      setReviewResult(data)
      showMessage('Code review completed!', 'success')
    } catch (err) {
      console.error(err)
      showMessage('Failed to review code', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleChat = async () => {
    if (!chatInput.trim()) {
      return
    }

    const userMessage = { role: 'user', content: chatInput }
    const newMessages = [...chatMessages, userMessage]
    setChatMessages(newMessages)
    setChatInput('')

    setLoading(true)

    try {
      const response = await apiFetch(`/api/v1/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: newMessages,
          language,
        }),
      })

      if (!response.ok) {
        throw new Error('Chat failed')
      }

      const data = await response.json()
      const assistantMessage = { role: 'assistant', content: data.message }
      setChatMessages([...newMessages, assistantMessage])

      // If code was generated, show it
      if (data.code) {
        setGeneratedCode(data.code)
      }
    } catch (err) {
      console.error(err)
      showMessage('Failed to send message', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 3000)
  }

  if (!isAuthenticated) {
    return (
      <div className="text-center py-20">
        <h2 className="text-4xl font-bold neon-text mb-4">ACCESS DENIED</h2>
        <p className="text-cyan-300 mb-8">Please authenticate to access AI features</p>
        <button
          onClick={() => (window.location.href = '/login')}
          className="cyber-btn px-8 py-3"
        >
          Initialize Session
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="cyber-card p-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold neon-text tracking-wider">{'<AI/>'}</h2>
            <p className="text-sm text-gray-400 mt-1">
              AI-Powered Code Assistant
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('generate')}
              className={`cyber-btn px-4 py-2 text-sm ${
                mode === 'generate' ? 'border-cyan-500 text-cyan-400' : ''
              }`}
            >
              Generate
            </button>
            <button
              onClick={() => setMode('review')}
              className={`cyber-btn px-4 py-2 text-sm ${
                mode === 'review' ? 'border-cyan-500 text-cyan-400' : ''
              }`}
            >
              Review
            </button>
            <button
              onClick={() => setMode('chat')}
              className={`cyber-btn px-4 py-2 text-sm ${
                mode === 'chat' ? 'border-cyan-500 text-cyan-400' : ''
              }`}
            >
              Chat
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`mt-4 p-3 rounded text-sm ${
            message.includes('success') || message.includes('successfully')
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}>
            {message}
          </div>
        )}
      </div>

      {/* Mode Content */}
      {mode === 'generate' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="cyber-card p-6">
            <h3 className="text-xl font-semibold neon-text-cyan mb-4 tracking-wider">
              {'<INPUT/>'}
            </h3>

            {/* Language Selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-cyan-300 mb-2 tracking-wider">
                LANGUAGE
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all cursor-pointer"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Presets */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-cyan-300 mb-2 tracking-wider">
                QUICK PROMPTS
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_PROMPTS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setPrompt(preset.prompt)}
                    className="text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-cyan-500/50 rounded text-sm text-gray-300 transition-all"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-cyan-300 mb-2 tracking-wider">
                PROMPT
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all resize-none"
                placeholder="Describe what code you want to generate..."
                rows={4}
              />
            </div>

            {/* Context Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-cyan-300 mb-2 tracking-wider">
                CONTEXT (OPTIONAL)
              </label>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                className="w-full bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all resize-none"
                placeholder="Add additional context or existing code..."
                rows={3}
              />
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt.trim()}
              className="w-full cyber-btn py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
            >
              {loading ? '◌ GENERATING...' : '► GENERATE CODE'}
            </button>
          </div>

          {/* Output Panel */}
          <div className="cyber-card p-6">
            <h3 className="text-xl font-semibold neon-text-purple mb-4 tracking-wider">
              {'<OUTPUT/>'}
            </h3>

            {explanation && (
              <div className="mb-4 p-4 bg-purple-500/10 border border-purple-500/30 rounded">
                <p className="text-sm text-purple-300">{explanation}</p>
              </div>
            )}

            {generatedCode ? (
              <CodeEditor
                value={generatedCode}
                onChange={() => {}}
                language={language}
                theme="vs-dark"
                height="500px"
              />
            ) : (
              <div className="text-center py-20">
                <div className="text-6xl mb-4">{'</>'}</div>
                <p className="text-gray-500">Generated code will appear here</p>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'review' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="cyber-card p-6">
            <h3 className="text-xl font-semibold neon-text-cyan mb-4 tracking-wider">
              {'<CODE TO REVIEW/>'}
            </h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-cyan-300 mb-2 tracking-wider">
                LANGUAGE
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all cursor-pointer"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              value={reviewCode}
              onChange={(e) => setReviewCode(e.target.value)}
              className="w-full bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all resize-none font-mono"
              placeholder="Paste your code here for review..."
              rows={15}
            />

            <button
              onClick={handleReview}
              disabled={loading || !reviewCode.trim()}
              className="w-full mt-4 cyber-btn py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--color-neon-pink)', color: 'var(--color-neon-pink)' }}
            >
              {loading ? '◌ ANALYZING...' : '► REVIEW CODE'}
            </button>
          </div>

          {/* Results Panel */}
          <div className="cyber-card p-6">
            <h3 className="text-xl font-semibold neon-text-purple mb-4 tracking-wider">
              {'<RESULTS/>'}
            </h3>

            {reviewResult ? (
              <div className="space-y-4">
                {/* Score */}
                <div className="text-center">
                  <div className="text-sm text-gray-400 mb-2">Overall Score</div>
                  <div className={`text-5xl font-bold ${
                    reviewResult.overall_score >= 80 ? 'text-green-400' :
                    reviewResult.overall_score >= 60 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {reviewResult.overall_score}
                  </div>
                </div>

                {/* Issues */}
                {reviewResult.issues && reviewResult.issues.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-red-400 mb-2">Issues Found</h4>
                    <div className="space-y-2">
                      {reviewResult.issues.map((issue: string, i: number) => (
                        <div key={i} className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
                          {issue}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggestions */}
                {reviewResult.suggestions && reviewResult.suggestions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-cyan-400 mb-2">Suggestions</h4>
                    <div className="space-y-2">
                      {reviewResult.suggestions.map((suggestion: string, i: number) => (
                        <div key={i} className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded text-sm text-cyan-300">
                          {suggestion}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="text-6xl mb-4">{'{Review}'}</div>
                <p className="text-gray-500">Review results will appear here</p>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'chat' && (
        <div className="cyber-card p-6">
          <h3 className="text-xl font-semibold neon-text-cyan mb-4 tracking-wider">
            {'<AI CHAT/>'}
          </h3>

          {/* Chat Messages */}
          <div className="mb-4 max-h-96 overflow-y-auto space-y-4">
            {chatMessages.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-2">{'<AI>'}</div>
                <p>Start a conversation with the AI assistant</p>
              </div>
            ) : (
              chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-4 rounded ${
                    msg.role === 'user'
                      ? 'bg-cyan-500/10 border border-cyan-500/30 ml-8'
                      : 'bg-purple-500/10 border border-purple-500/30 mr-8'
                  }`}
                >
                  <div className="text-xs text-gray-500 mb-2">
                    {msg.role === 'user' ? 'YOU' : 'AI ASSISTANT'}
                  </div>
                  <div className="text-sm text-gray-200 whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleChat()}
              className="flex-1 bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
              placeholder="Ask me anything about code..."
            />
            <button
              onClick={handleChat}
              disabled={loading || !chatInput.trim()}
              className="cyber-btn px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '◌' : '►'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
