import { useState, useEffect, useCallback } from 'react'
import type { TrainingTask, TrainingStatus } from '../types/agent'
import { agentService } from '../services/agentService'

interface TrainingTabProps {
  token: string
}

const statusConfig: Record<TrainingStatus, { color: string; label: string; bgColor: string }> = {
  pending: { color: 'text-yellow-400', label: 'Pending', bgColor: 'bg-yellow-500/20' },
  running: { color: 'text-blue-400', label: 'Running', bgColor: 'bg-blue-500/20' },
  completed: { color: 'text-green-400', label: 'Completed', bgColor: 'bg-green-500/20' },
  failed: { color: 'text-red-400', label: 'Failed', bgColor: 'bg-red-500/20' },
}

export default function TrainingTab({ token }: TrainingTabProps) {
  const [tasks, setTasks] = useState<TrainingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadTasks = useCallback(async () => {
    try {
      const response = await agentService.getTrainingTasks(token)
      setTasks(response.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('zh-CN')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-cyan-300">Training Tasks</h3>
          <p className="text-sm text-gray-500">Manage agent training tasks</p>
        </div>
        <button
          className="cyber-btn px-4 py-2 text-sm"
          style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
        >
          + New Task
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 border border-red-500/50 rounded bg-red-500/10 flex justify-between items-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 hover:text-white">
            ×
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12">
          <div className="animate-spin text-4xl neon-text">◌</div>
          <p className="text-gray-400 mt-4">Loading...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && tasks.length === 0 && (
        <div className="cyber-card p-12 text-center">
          <div className="text-6xl mb-4 opacity-50">🎓</div>
          <h3 className="text-2xl font-semibold neon-text mb-4">NO TRAINING TASKS</h3>
          <div className="h-1 w-48 mx-auto bg-gradient-to-r from-transparent via-cyan-500 to-transparent mb-6"></div>
          <p className="text-gray-400">No training tasks yet</p>
        </div>
      )}

      {/* Task list */}
      {!loading && tasks.length > 0 && (
        <div className="space-y-4">
          {tasks.map((task) => {
            const status = statusConfig[task.status]
            return (
              <div key={task.id} className="cyber-card p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="text-lg font-medium text-gray-200">{task.name}</h4>
                    {task.description && (
                      <p className="text-sm text-gray-500 mt-1">{task.description}</p>
                    )}
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs ${status.bgColor} ${status.color}`}
                  >
                    {status.label}
                  </span>
                </div>

                {/* Progress bar */}
                {(task.status === 'running' || task.status === 'completed') && (
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Progress</span>
                      <span>{task.progress}%</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-300"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error info */}
                {task.status === 'failed' && task.error_message && (
                  <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded">
                    <p className="text-sm text-red-400">{task.error_message}</p>
                  </div>
                )}

                {/* Time info */}
                <div className="flex gap-6 text-xs text-gray-500">
                  <span>Created: {formatDate(task.created_at)}</span>
                  {task.started_at && <span>Started: {formatDate(task.started_at)}</span>}
                  {task.completed_at && <span>Completed: {formatDate(task.completed_at)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
