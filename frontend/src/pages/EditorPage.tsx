import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/apiClient'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import CodeEditor from '../components/Editor'

interface CodeFile {
  id: number
  filename: string
  path: string
  language: string
  content: string
  project_id: number
  full_path: string
}

interface Project {
  id: number
  name: string
  description: string
}

const DEFAULT_CODE = `// Welcome to Smart Code Assistant
// Start writing your code here...

function example() {
  console.log('Hello, World!')
  return true
}

example()`

const LANGUAGE_MAP: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  csharp: 'csharp',
  go: 'go',
  rust: 'rust',
  cpp: 'cpp',
  html: 'html',
  css: 'css',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  markdown: 'markdown',
  sql: 'sql',
  bash: 'shell',
}

export default function EditorPage() {
  const { isAuthenticated, token } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [code, setCode] = useState(DEFAULT_CODE)
  const [language, setLanguage] = useState('javascript')
  const [filename, setFilename] = useState('untitled.js')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [fileId, setFileId] = useState<number | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<CodeFile[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showNewFileModal, setShowNewFileModal] = useState(false)
  const [newFileName, setNewFileName] = useState('')

  // Get project and file IDs from URL
  useEffect(() => {
    const projId = searchParams.get('project')
    const fileIdParam = searchParams.get('file')

    if (projId) {
      setProjectId(parseInt(projId))
      loadProject(parseInt(projId), fileIdParam ? parseInt(fileIdParam) : null)
    }
  }, [searchParams])

  const loadProject = async (projId: number, fileId: number | null) => {
    if (!isAuthenticated || !token) {
      navigate('/login')
      return
    }

    setLoading(true)
    try {

      // Load project details
      const projectResp = await apiFetch(`/api/v1/projects/${projId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (projectResp.ok) {
        const projectData = await projectResp.json()
        setProject(projectData)
      }

      // Load files
      const filesResp = await apiFetch(`/api/v1/code-files?project_id=${projId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (filesResp.ok) {
        const filesData = await filesResp.json()
        setFiles(filesData)

        // Load specific file or first file
        if (fileId) {
          await loadFile(fileId)
        } else if (filesData.length > 0) {
          await loadFile(filesData[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to load project:', err)
      showMessage('Failed to load project', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadFile = async (id: number) => {
    if (!isAuthenticated || !token) return

    try {
      const resp = await apiFetch(`/api/v1/code-files/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (resp.ok) {
        const file: CodeFile = await resp.json()
        setFileId(file.id)
        setFilename(file.filename)
        setCode(file.content || DEFAULT_CODE)
        setLanguage(file.language)

        // Update URL without triggering reload
        const url = new URL(window.location.href)
        url.searchParams.set('file', file.id.toString())
        window.history.replaceState({}, '', url.toString())
      }
    } catch (err) {
      console.error('Failed to load file:', err)
      showMessage('Failed to load file', 'error')
    }
  }

  const saveFile = async () => {
    if (!isAuthenticated || !token || !projectId) {
      showMessage('Please select a project first', 'error')
      return
    }

    setSaving(true)
    try {

      if (fileId) {
        // Update existing file
        const resp = await apiFetch(`/api/v1/code-files/${fileId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: code }),
        })

        if (resp.ok) {
          showMessage('File saved successfully!', 'success')
        } else {
          throw new Error('Failed to save file')
        }
      } else {
        // Create new file
        const resp = await apiFetch(`/api/v1/code-files`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            filename: filename,
            path: '',
            language: language,
            content: code,
            project_id: projectId,
          }),
        })

        if (resp.ok) {
          const newFile: CodeFile = await resp.json()
          setFileId(newFile.id)
          setFiles([...files, newFile])
          showMessage('File created successfully!', 'success')
        } else {
          throw new Error('Failed to create file')
        }
      }
    } catch (err) {
      console.error('Failed to save file:', err)
      showMessage('Failed to save file', 'error')
    } finally {
      setSaving(false)
    }
  }

  const createNewFile = async () => {
    if (!newFileName.trim()) {
      showMessage('Please enter a file name', 'error')
      return
    }

    if (!isAuthenticated || !token || !projectId) {
      showMessage('Please select a project first', 'error')
      return
    }

    // Detect language from extension
    const ext = newFileName.split('.').pop()?.toLowerCase() || 'txt'
    const detectedLang = LANGUAGE_MAP[ext] || 'javascript'

    try {
      const resp = await apiFetch(`/api/v1/code-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: newFileName,
          path: '',
          language: detectedLang,
          content: '',
          project_id: projectId,
        }),
      })

      if (resp.ok) {
        const newFile: CodeFile = await resp.json()
        setFiles([...files, newFile])
        setFileId(newFile.id)
        setFilename(newFile.filename)
        setCode('')
        setLanguage(detectedLang)
        setShowNewFileModal(false)
        setNewFileName('')
        showMessage('File created successfully!', 'success')
      } else {
        throw new Error('Failed to create file')
      }
    } catch (err) {
      console.error('Failed to create file:', err)
      showMessage('Failed to create file', 'error')
    }
  }

  const showMessage = (msg: string, _type: 'success' | 'error') => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 3000)
  }

  // Detect language from filename
  useEffect(() => {
    const ext = filename.split('.').pop()?.toLowerCase() || 'js'
    const detectedLang = LANGUAGE_MAP[ext] || 'javascript'
    setLanguage(detectedLang)
  }, [filename])

  if (!isAuthenticated) {
    return (
      <div className="text-center py-20">
        <h2 className="text-4xl font-bold neon-text mb-4">ACCESS DENIED</h2>
        <p className="text-cyan-300 mb-8">Please authenticate to access the code editor</p>
        <button
          onClick={() => navigate('/login')}
          className="cyber-btn px-8 py-3"
        >
          Initialize Session
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="animate-spin text-4xl neon-text">◌</div>
        <p className="text-gray-400 mt-4">Loading editor...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="cyber-card p-6">
        <div className="flex justify-between items-center">
          <div className="flex-1">
            <h2 className="text-3xl font-bold neon-text tracking-wider">{'<CODE/>'}</h2>
            <p className="text-sm text-gray-400 mt-1">
              {project ? (
                <>
                  Project: <span className="text-cyan-400">{project.name}</span>
                  {files.length > 0 && (
                    <span className="ml-4">Files: <span className="text-cyan-400">{files.length}</span></span>
                  )}
                </>
              ) : (
                'Select a project to start coding'
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={saveFile}
              disabled={saving || !projectId}
              className="cyber-btn px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
            >
              {saving ? '◌ SAVING...' : '► SAVE'}
            </button>
            <button
              onClick={() => setShowNewFileModal(true)}
              disabled={!projectId}
              className="cyber-btn px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + NEW FILE
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

      {/* File List and Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* File Sidebar */}
        <div className="lg:col-span-1">
          <div className="cyber-card p-4">
            <h3 className="text-sm font-semibold text-cyan-300 mb-4 tracking-wider">
              {'{FILES}'}
            </h3>
            {files.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No files yet</p>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => loadFile(file.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-all ${
                      fileId === file.id
                        ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-300'
                        : 'hover:bg-gray-800 text-gray-400'
                    }`}
                  >
                    <div className="truncate">{file.filename}</div>
                    <div className="text-xs text-gray-500 truncate">{file.language}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="lg:col-span-3">
          <div className="cyber-card p-6">
            {/* Filename Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-cyan-300 mb-2 tracking-wider">
                FILENAME
              </label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="w-full bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                placeholder="untitled.js"
              />
            </div>

            {/* Language Selector */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-cyan-300 mb-2 tracking-wider">
                PROGRAMMING LANGUAGE
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-gray-900/50 border border-cyan-500/30 rounded px-4 py-3 text-sm text-gray-100 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all cursor-pointer"
              >
                {Object.entries(LANGUAGE_MAP).map(([key, value]) => (
                  <option key={key} value={value}>
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Editor */}
            <div className="relative">
              <div className="absolute -top-3 left-4 px-2 bg-gray-900 text-xs text-cyan-400 border border-cyan-500/30 rounded">
                SOURCE CODE
              </div>
              <CodeEditor
                value={code}
                onChange={(value) => setCode(value ?? '')}
                language={language}
                theme="vs-dark"
                height="500px"
              />
            </div>

            {/* Stats */}
            <div className="mt-6 flex justify-between items-center pt-4 border-t border-gray-700">
              <div className="flex gap-6 text-sm">
                <span className="text-gray-400">
                  LINES: <span className="text-cyan-400 font-mono">{code.split('\n').length}</span>
                </span>
                <span className="text-gray-400">
                  CHARS: <span className="text-cyan-400 font-mono">{code.length}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                READY
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New File Modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-card max-w-md w-full p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold neon-text-cyan tracking-wider">
                {'<NEW FILE />'}
              </h3>
              <button
                onClick={() => setShowNewFileModal(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-cyan-300 mb-2">
                  FILENAME
                </label>
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-900/50 border border-cyan-500/30 rounded text-gray-100 placeholder-gray-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  placeholder="example.js"
                  onKeyPress={(e) => e.key === 'Enter' && createNewFile()}
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">
                  Supported: .js, .ts, .py, .java, .go, .rs, etc.
                </p>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setShowNewFileModal(false)}
                  className="flex-1 cyber-btn py-3"
                >
                  Cancel
                </button>
                <button
                  onClick={createNewFile}
                  className="flex-1 cyber-btn py-3"
                  style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
