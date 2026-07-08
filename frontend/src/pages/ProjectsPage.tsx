import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Project {
  id: number
  name: string
  description: string
  owner_id: number
  created_at: string
  updated_at: string
  file_count: number
}

interface ProjectListResponse {
  projects: Project[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export default function ProjectsPage() {
  const { isAuthenticated, token } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchProjects = async (pageNum = 1) => {
    if (!isAuthenticated || !token) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(`/api/v1/projects?page=${pageNum}&page_size=20`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch projects')
      }

      const data: ProjectListResponse = await response.json()
      setProjects(data.projects)
      setTotalPages(data.total_pages)
      setPage(data.page)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!newProjectName.trim()) {
      setError('Project name is required')
      return
    }

    setCreating(true)
    setError('')

    try {
      const response = await apiFetch(`/api/v1/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newProjectName,
          description: newProjectDescription || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Failed to create project')
      }

      // Reset form and refresh
      setNewProjectName('')
      setNewProjectDescription('')
      setShowCreateModal(false)
      fetchProjects(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    fetchProjects()
  }, [isAuthenticated, token])

  if (!isAuthenticated) {
    return (
      <div className="text-center py-20">
        <h2 className="text-4xl font-bold neon-text mb-4">ACCESS DENIED</h2>
        <p className="text-cyan-300 mb-8">Please authenticate to access your projects</p>
        <Link to="/login" className="cyber-btn">
          Initialize Session
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold neon-text tracking-wider">{'<PROJECTS />'}</h2>
          <div className="h-px w-32 bg-gradient-to-r from-cyan-500 to-transparent mt-2"></div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="cyber-btn px-6 py-2"
          style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
        >
          + New Project
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 border border-red-500/50 rounded bg-red-500/10">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin text-4xl neon-text">◌</div>
          <p className="text-gray-400 mt-4">Loading projects...</p>
        </div>
      ) : projects.length === 0 ? (
        /* Empty State */
        <div className="cyber-card p-12 text-center">
          <div className="text-6xl mb-4">{'<>'}</div>
          <h3 className="text-2xl font-semibold neon-text mb-4">No Projects Yet</h3>
          <p className="text-gray-400 mb-8">Create your first project to start coding</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="cyber-btn px-8 py-3"
            style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
          >
            Create Project
          </button>
        </div>
      ) : (
        /* Projects Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/editor?project=${project.id}`}
              className="cyber-card p-6 hover:border-cyan-500/50 transition-all float-animation"
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-semibold neon-text truncate flex-1">{project.name}</h3>
                <span className="text-xs text-gray-500 ml-2">{project.file_count} files</span>
              </div>
              {project.description && (
                <p className="text-gray-400 text-sm mb-4 line-clamp-2">{project.description}</p>
              )}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Created: {new Date(project.created_at).toLocaleDateString()}</span>
                <span>Updated: {new Date(project.updated_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <button
            onClick={() => fetchProjects(page - 1)}
            disabled={page === 1}
            className="cyber-btn px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-gray-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => fetchProjects(page + 1)}
            disabled={page === totalPages}
            className="cyber-btn px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-card max-w-md w-full p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold neon-text-purple tracking-wider">
                {'<NEW PROJECT />'}
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-purple-300 mb-2">
                  PROJECT NAME *
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-purple-500/30 rounded text-gray-100 placeholder-gray-500 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  placeholder="My Awesome Project"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-purple-300 mb-2">
                  DESCRIPTION
                </label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-purple-500/30 rounded text-gray-100 placeholder-gray-500 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all resize-none"
                  placeholder="What is this project about?"
                  rows={3}
                />
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 cyber-btn py-3"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newProjectName.trim()}
                  className="flex-1 cyber-btn py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
