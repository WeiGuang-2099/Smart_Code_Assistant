import { useState, useEffect } from 'react'
import type { Agent, AgentUpdate } from '../types/agent'
import { agentService } from '../services/agentService'

interface AgentEditDialogProps {
  open: boolean
  token: string
  agentId: number
  onClose: () => void
  onComplete: () => void
}

// Available domains
const DOMAIN_OPTIONS = [
  { value: 'code', label: 'Code Development', icon: '💻' },
  { value: 'writing', label: 'Content Writing', icon: '✍️' },
  { value: 'analysis', label: 'Data Analysis', icon: '📊' },
  { value: 'design', label: 'Design & Creative', icon: '🎨' },
  { value: 'translation', label: 'Translation', icon: '🌐' },
  { value: 'general', label: 'General Assistant', icon: '🤖' },
]

// Status options
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft', color: 'text-gray-400' },
  { value: 'active', label: 'Active', color: 'text-green-400' },
  { value: 'inactive', label: 'Inactive', color: 'text-yellow-400' },
  { value: 'training', label: 'Training', color: 'text-purple-400' },
]

export default function AgentEditDialog({
  open,
  token,
  agentId,
  onClose,
  onComplete,
}: AgentEditDialogProps) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [status, setStatus] = useState<AgentUpdate['status']>('draft')

  // Load agent data
  useEffect(() => {
    if (open && agentId) {
      loadAgent()
    }
  }, [open, agentId, token])

  const loadAgent = async () => {
    setLoading(true)
    setError('')

    try {
      const data = await agentService.getAgent(token, agentId)
      setAgent(data)
      setName(data.name)
      setDomain(data.domain || '')
      setDescription(data.description || '')
      setSystemPrompt(data.system_prompt || '')
      setStatus(data.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      await agentService.updateAgent(token, agentId, {
        name: name.trim(),
        domain: domain || undefined,
        description: description.trim() || undefined,
        system_prompt: systemPrompt.trim() || undefined,
        status,
      })
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setError('')
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="cyber-card max-w-lg w-full p-8 animate-slideUp">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold neon-text-purple tracking-wider">
            {'<EDIT AGENT />'}
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white text-2xl transition-colors"
          >
            ×
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin text-2xl neon-text">◌</div>
            <p className="text-gray-400 mt-2">Loading agent...</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 border border-red-500/50 rounded bg-red-500/10 flex justify-between items-center">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-white">
              ×
            </button>
          </div>
        )}

        {/* Form */}
        {!loading && agent && (
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-purple-300 mb-2">
                Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border border-purple-500/30 rounded
                           text-gray-100 placeholder-gray-500 focus:border-purple-500
                           focus:ring-2 focus:ring-purple-500/20 transition-all"
                placeholder="Agent name..."
                maxLength={100}
              />
            </div>

            {/* Domain */}
            <div>
              <label className="block text-sm font-medium text-purple-300 mb-2">
                Domain
              </label>
              <div className="grid grid-cols-3 gap-2">
                {DOMAIN_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDomain(option.value)}
                    className={`
                      px-3 py-2 rounded text-sm transition-all flex items-center gap-1.5
                      ${
                        domain === option.value
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                          : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:border-gray-600'
                      }
                    `}
                  >
                    <span>{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-purple-300 mb-2">
                Status
              </label>
              <div className="flex gap-2">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatus(option.value as AgentUpdate['status'])}
                    className={`
                      px-3 py-2 rounded text-sm transition-all
                      ${
                        status === option.value
                          ? `bg-gray-700/50 ${option.color} border border-current`
                          : 'bg-gray-800/50 text-gray-400 border border-gray-700 hover:border-gray-600'
                      }
                    `}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-purple-300 mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border border-purple-500/30 rounded
                           text-gray-100 placeholder-gray-500 focus:border-purple-500
                           focus:ring-2 focus:ring-purple-500/20 transition-all resize-none"
                placeholder="Describe what this agent does..."
                rows={3}
              />
            </div>

            {/* System Prompt */}
            <div>
              <label className="block text-sm font-medium text-purple-300 mb-2">
                System Prompt
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border border-purple-500/30 rounded
                           text-gray-100 placeholder-gray-500 focus:border-purple-500
                           focus:ring-2 focus:ring-purple-500/20 transition-all resize-none font-mono text-sm"
                placeholder="You are a helpful assistant..."
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">
                Define the agent's behavior and role
              </p>
            </div>

            {/* Statistics */}
            <div className="p-3 bg-gray-800/50 rounded border border-gray-700">
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="text-cyan-400">💬</span>
                  {agent.conversation_count} conversations
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-purple-400">📅</span>
                  Created {new Date(agent.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div className="flex gap-4 mt-6">
            <button onClick={handleClose} className="flex-1 cyber-btn py-3" disabled={saving}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex-1 cyber-btn py-3 disabled:opacity-50"
              style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
