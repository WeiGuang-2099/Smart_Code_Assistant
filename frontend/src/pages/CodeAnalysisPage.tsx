import { useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../contexts/AuthContext'
import CodeGraph from '../components/CodeGraph'
import type { GraphNode, GraphEdge } from '../components/CodeGraph'


type GraphQueryType = 'search' | 'dependencies' | 'impact' | 'paths'

// Module path sent with full analysis; nodes built from the editor carry this module.
const EDITOR_MODULE = 'editor_input'

interface AnalysisResult {
  type: string
  success: boolean
  result: string
  error?: string
}

interface FullAnalysisResponse {
  structure?: string
  smells?: string
  complexity?: string
  security?: string
  graph_built: boolean
  graph_stats?: { nodes: number; relationships: number; error?: string }
  overall_score: number
  summary: string
  recommendations: string[]
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: { node_count: number; edge_count: number }
}

export default function CodeAnalysisPage() {
  const { token, isAuthenticated } = useAuth()

  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('python')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Basic analysis results
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([])

  // Full analysis results
  const [fullAnalysis, setFullAnalysis] = useState<FullAnalysisResponse | null>(null)

  // GraphRAG query
  const [graphQuery, setGraphQuery] = useState('')
  const [graphQueryType, setGraphQueryType] = useState<GraphQueryType>('search')
  const [graphResult, setGraphResult] = useState<string>('')
  const [graphLoading, setGraphLoading] = useState(false)

  // Graph visualization
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [graphVizLoading, setGraphVizLoading] = useState(false)

  // Analysis options
  const [enableGraph, setEnableGraph] = useState(true)
  const [activeTab, setActiveTab] = useState<'editor' | 'results' | 'visualize' | 'graph'>('editor')

  const runBasicAnalysis = async () => {
    if (!code.trim() || !token) return

    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(`/api/v1/code-analysis/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code,
          language,
          analysis_types: ['all_basic'],
        }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      setAnalysisResults(data.results)
      setActiveTab('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const runFullAnalysis = async () => {
    if (!code.trim() || !token) return

    setLoading(true)
    setError('')
    setFullAnalysis(null)

    try {
      const response = await apiFetch(`/api/v1/code-analysis/full-analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code,
          language,
          module_path: EDITOR_MODULE,
          enable_graph: enableGraph,
          enable_basic: true,
        }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      setFullAnalysis(data)
      setActiveTab('results')

      // Auto-load the visualization when a graph was built.
      if (data.graph_built) {
        loadGraphVisualization()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const runGraphQuery = async () => {
    if (!graphQuery.trim() || !token) return

    setGraphLoading(true)
    setGraphResult('')

    try {
      const response = await apiFetch(`/api/v1/code-analysis/graph/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: graphQuery,
          query_type: graphQueryType,
          project_id: 1,
        }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      setGraphResult(data.result || JSON.stringify(data, null, 2))
    } catch (err) {
      setGraphResult(`Query failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setGraphLoading(false)
    }
  }

  const loadGraphVisualization = async () => {
    if (!token) return

    setGraphVizLoading(true)

    try {
      const response = await apiFetch(`/api/v1/code-graph/visualize?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()

      if (data.success && data.nodes.length > 0) {
        setGraphData({ nodes: data.nodes, edges: data.edges, stats: data.stats })
      } else {
        setGraphData(null)
      }
    } catch (err) {
      console.error('Failed to load graph:', err)
      setGraphData(null)
    } finally {
      setGraphVizLoading(false)
    }
  }

  // Clicking a node in the graph prefills the dependency query and jumps to the Query tab.
  const handleNodeSelect = (node: GraphNode) => {
    setGraphQuery(node.label)
    setGraphQueryType('dependencies')
    setActiveTab('graph')
  }

  const renderAnalysisResult = (result: string) => {
    return result.split('\n').map((line, i) => {
      if (line.startsWith('━')) {
        return <div key={i} className="border-t border-gray-700 my-2" />
      }
      if (line.includes('•')) {
        return (
          <div key={i} className="text-gray-300 text-sm pl-2 py-0.5">
            {line}
          </div>
        )
      }
      if (line.includes('⚠️') || line.includes('🔴') || line.includes('🟠')) {
        return (
          <div key={i} className="text-yellow-400 text-sm pl-2 py-0.5">
            {line}
          </div>
        )
      }
      if (line.includes('✅') || line.includes('🟢')) {
        return (
          <div key={i} className="text-green-400 text-sm pl-2 py-0.5">
            {line}
          </div>
        )
      }
      return (
        <div key={i} className="text-gray-300 text-sm">
          {line}
        </div>
      )
    })
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400'
    if (score >= 60) return 'text-yellow-400'
    return 'text-red-400'
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="text-6xl mb-4">&#128274;</div>
          <h3 className="text-xl font-semibold text-gray-300 mb-2">Sign in required</h3>
          <p className="text-gray-500">Please sign in to use code analysis</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold neon-text">Code Analysis</h1>
          <p className="text-gray-400 text-sm mt-1">Basic analysis + GraphRAG knowledge graph</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="px-3 py-2 bg-gray-900/50 border border-cyan-500/30 rounded-lg text-gray-300"
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={enableGraph}
              onChange={(e) => setEnableGraph(e.target.checked)}
              className="rounded border-gray-600 bg-gray-900"
            />
            Build knowledge graph
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-700">
        {[
          { id: 'editor', label: 'Editor' },
          { id: 'results', label: 'Results' },
          { id: 'visualize', label: 'Visualize' },
          { id: 'graph', label: 'Query' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id as typeof activeTab)
              if (tab.id === 'visualize' && !graphData) {
                loadGraphVisualization()
              }
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-cyan-400 border-cyan-400'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 border border-red-500/50 rounded-lg bg-red-500/10">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Editor Tab */}
      {activeTab === 'editor' && (
        <div className="space-y-4">
          <div className="relative">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste or type code..."
              className="w-full h-96 px-4 py-3 bg-gray-900/50 border border-cyan-500/30 rounded-lg
                         text-gray-100 font-mono text-sm resize-none
                         focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
            />
            <div className="absolute bottom-3 right-3 text-xs text-gray-500">
              {code.split('\n').length} lines
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={runBasicAnalysis}
              disabled={loading || !code.trim()}
              className="px-6 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30
                         hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Analyzing...' : 'Basic Analysis'}
            </button>
            <button
              onClick={runFullAnalysis}
              disabled={loading || !code.trim()}
              className="px-6 py-2 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30
                         hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Analyzing...' : 'Full Analysis + GraphRAG'}
            </button>
          </div>
        </div>
      )}

      {/* Results Tab */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          {fullAnalysis && (
            <div className="cyber-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-100">Overall Assessment</h3>
                <div className={`text-3xl font-bold ${getScoreColor(fullAnalysis.overall_score)}`}>
                  {fullAnalysis.overall_score}
                </div>
              </div>
              <p className="text-gray-400 mb-4">{fullAnalysis.summary}</p>

              {fullAnalysis.recommendations.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-300 mb-2">Recommendations:</h4>
                  <ul className="space-y-1">
                    {fullAnalysis.recommendations.map((rec, i) => (
                      <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
                        <span className="text-cyan-400">&bull;</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Inline knowledge graph - part of the analysis result */}
          {fullAnalysis?.graph_built && (
            <div className="cyber-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-100">Knowledge Graph</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Entities from your code are highlighted; explore how they connect to the rest of the project.
                  </p>
                </div>
                {fullAnalysis.graph_stats && (
                  <button
                    onClick={() => {
                      setActiveTab('visualize')
                      if (!graphData) loadGraphVisualization()
                    }}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    Open full explorer &rarr;
                  </button>
                )}
              </div>
              <CodeGraph
                nodes={graphData?.nodes ?? []}
                edges={graphData?.edges ?? []}
                loading={graphVizLoading}
                highlightModule={EDITOR_MODULE}
                onRefresh={loadGraphVisualization}
                onNodeSelect={handleNodeSelect}
                height={460}
              />
            </div>
          )}

          {fullAnalysis?.structure && (
            <div className="cyber-card p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-3">Structure Analysis</h3>
              <div className="bg-gray-900/50 rounded-lg p-4">
                {renderAnalysisResult(fullAnalysis.structure)}
              </div>
            </div>
          )}

          {fullAnalysis?.security && (
            <div className="cyber-card p-6">
              <h3 className="text-lg font-semibold text-gray-100 mb-3">Security Check</h3>
              <div className="bg-gray-900/50 rounded-lg p-4">
                {renderAnalysisResult(fullAnalysis.security)}
              </div>
            </div>
          )}

          {!analysisResults.length && !fullAnalysis && (
            <div className="text-center py-12 text-gray-500">
              <div className="text-4xl mb-4">&#128203;</div>
              <p>No analysis results yet</p>
              <p className="text-sm mt-2">Enter code in the Editor tab and run an analysis</p>
            </div>
          )}
        </div>
      )}

      {/* Graph Visualization Tab */}
      {activeTab === 'visualize' && (
        <div className="cyber-card p-4">
          <h3 className="text-lg font-semibold text-gray-100 mb-4">Code Knowledge Graph</h3>
          <CodeGraph
            nodes={graphData?.nodes ?? []}
            edges={graphData?.edges ?? []}
            loading={graphVizLoading}
            onRefresh={loadGraphVisualization}
            onNodeSelect={handleNodeSelect}
            height={560}
          />
        </div>
      )}

      {/* Graph Query Tab */}
      {activeTab === 'graph' && (
        <div className="space-y-4">
          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Graph Query</h3>

            <div className="flex gap-4 mb-4">
              <select
                value={graphQueryType}
                onChange={(e) => setGraphQueryType(e.target.value as GraphQueryType)}
                className="px-3 py-2 bg-gray-900/50 border border-cyan-500/30 rounded-lg text-gray-300"
              >
                <option value="search">Semantic Search</option>
                <option value="dependencies">Dependencies</option>
                <option value="impact">Impact Analysis</option>
                <option value="paths">Path Finding</option>
              </select>

              <input
                type="text"
                value={graphQuery}
                onChange={(e) => setGraphQuery(e.target.value)}
                placeholder={
                  graphQueryType === 'search'
                    ? 'Natural-language query, e.g. functions that handle user authentication'
                    : graphQueryType === 'dependencies'
                    ? 'Function or class name'
                    : graphQueryType === 'impact'
                    ? 'Entity name to analyze'
                    : 'source,target (comma-separated)'
                }
                className="flex-1 px-4 py-2 bg-gray-900/50 border border-cyan-500/30 rounded-lg
                           text-gray-100 placeholder-gray-500"
              />

              <button
                onClick={runGraphQuery}
                disabled={graphLoading || !graphQuery.trim()}
                className="px-6 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30
                           hover:bg-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {graphLoading ? 'Querying...' : 'Query'}
              </button>
            </div>

            {graphResult && (
              <div className="bg-gray-900/50 rounded-lg p-4">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                  {graphResult}
                </pre>
              </div>
            )}
          </div>

          <div className="cyber-card p-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Query Types</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-900/30 rounded-lg">
                <h4 className="text-cyan-400 font-medium mb-2">Semantic Search</h4>
                <p className="text-sm text-gray-400">
                  Search code entities in natural language, e.g. "functions that handle user login".
                </p>
              </div>
              <div className="p-4 bg-gray-900/30 rounded-lg">
                <h4 className="text-purple-400 font-medium mb-2">Dependencies</h4>
                <p className="text-sm text-gray-400">
                  Inspect a function/class's call relationships: who calls it and what it calls.
                </p>
              </div>
              <div className="p-4 bg-gray-900/30 rounded-lg">
                <h4 className="text-yellow-400 font-medium mb-2">Impact Analysis</h4>
                <p className="text-sm text-gray-400">
                  See which other code is affected when you change a given function.
                </p>
              </div>
              <div className="p-4 bg-gray-900/30 rounded-lg">
                <h4 className="text-green-400 font-medium mb-2">Path Finding</h4>
                <p className="text-sm text-gray-400">
                  Find the call path between two functions.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
