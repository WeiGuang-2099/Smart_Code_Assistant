/**
 * CodeGraph - Neon force-directed knowledge graph.
 *
 * Renders the code knowledge graph with real d3-force physics (via
 * react-force-graph-2d), glowing nodes sized by degree, relationship-colored
 * links with particles flowing source -> target, hover-to-highlight neighbors,
 * and a detail panel. Nodes whose module matches `highlightModule` (e.g. the
 * code the user just analyzed) get a distinct pulsing ring.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

export interface GraphNode {
  id: string
  label: string
  type: string
  color: string
  module: string
  class?: string | null
  docstring?: string | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label: string
  color: string
}

interface CodeGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  loading?: boolean
  /** Nodes whose `module` equals this value are highlighted with a pulsing ring. */
  highlightModule?: string
  onRefresh?: () => void
  /** Called when a node is clicked (used to cross-link into the query tab). */
  onNodeSelect?: (node: GraphNode) => void
  height?: number
}

// Runtime shape: the force engine assigns x/y after mount, so they're optional here.
type PositionedNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number }
type ForceLink = {
  source: string | PositionedNode
  target: string | PositionedNode
  color: string
  label: string
}

const DEFAULT_NODE_COLOR = '#22d3ee'

function linkEndId(end: string | PositionedNode | undefined): string {
  if (end == null) return ''
  return typeof end === 'object' ? end.id : end
}

export default function CodeGraph({
  nodes,
  edges,
  loading = false,
  highlightModule,
  onRefresh,
  onNodeSelect,
  height = 520,
}: CodeGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  const [hoverId, setHoverId] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  // Degree per node (drives node radius) and neighbour adjacency (drives hover highlight).
  const { degree, neighbors } = useMemo(() => {
    const degree = new Map<string, number>()
    const neighbors = new Map<string, Set<string>>()
    for (const n of nodes) {
      degree.set(n.id, 0)
      neighbors.set(n.id, new Set())
    }
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
      neighbors.get(e.source)?.add(e.target)
      neighbors.get(e.target)?.add(e.source)
    }
    return { degree, neighbors }
  }, [nodes, edges])

  const radiusFor = useCallback(
    (id: string) => 4 + 2 * Math.sqrt(degree.get(id) ?? 0),
    [degree]
  )

  // Build graphData once per data change. The force engine mutates these objects
  // with x/y, so we must not recreate them on every render (that would reset the
  // layout). Highlight state is handled in the paint callbacks, not here.
  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({ ...e })),
    }),
    [nodes, edges]
  )

  // Which node ids / links to keep bright. Empty set => nothing dimmed.
  const activeId = hoverId ?? selected?.id ?? null
  const highlightNodeIds = useMemo(() => {
    if (!activeId) return null
    const set = new Set<string>([activeId])
    neighbors.get(activeId)?.forEach((id) => set.add(id))
    return set
  }, [activeId, neighbors])

  // Measure container width; keep the canvas responsive.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Spread nodes out for legibility, then fit to view once the layout settles.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !graphData.nodes.length) return
    fg.d3Force('charge')?.strength(-260)
    fg.d3Force('link')?.distance(80)
    fg.d3ReheatSimulation?.()
    const t = setTimeout(() => fg.zoomToFit(600, 90), 650)
    return () => clearTimeout(t)
  }, [graphData])

  const drawNode = useCallback(
    (node: PositionedNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x
      const y = node.y
      if (x == null || y == null) return

      const color = node.color || DEFAULT_NODE_COLOR
      const dim = highlightNodeIds != null && !highlightNodeIds.has(node.id)
      const isActive = node.id === activeId
      const r = radiusFor(node.id)

      ctx.globalAlpha = dim ? 0.12 : 1

      // Pulsing ring for the entities from the code just analyzed.
      if (highlightModule && node.module === highlightModule) {
        const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 380)
        ctx.beginPath()
        ctx.arc(x, y, r + 4, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0, 255, 136, ${dim ? 0.15 : pulse})`
        ctx.lineWidth = 2 / globalScale
        ctx.stroke()
      }

      // Glowing body.
      ctx.shadowColor = color
      ctx.shadowBlur = (isActive ? 22 : 12) * (dim ? 0.3 : 1)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.lineWidth = 1 / globalScale
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.stroke()

      // Labels: only when zoomed in enough, or for the active/highlighted node.
      if (globalScale > 1.3 || isActive || (highlightNodeIds?.has(node.id) ?? false)) {
        const fontSize = 11 / globalScale
        ctx.font = `${fontSize}px 'Orbitron', monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = dim ? 'rgba(224,224,224,0.4)' : '#e6faff'
        const label = node.label.length > 18 ? node.label.slice(0, 18) + '..' : node.label
        ctx.fillText(label, x, y + r + 2 / globalScale)
      }

      ctx.globalAlpha = 1
    },
    [highlightNodeIds, activeId, radiusFor, highlightModule]
  )

  const paintPointerArea = useCallback(
    (node: PositionedNode, color: string, ctx: CanvasRenderingContext2D) => {
      if (node.x == null || node.y == null) return
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x, node.y, radiusFor(node.id) + 3, 0, Math.PI * 2)
      ctx.fill()
    },
    [radiusFor]
  )

  const isLinkActive = useCallback(
    (link: ForceLink) => {
      if (!activeId) return true
      return linkEndId(link.source) === activeId || linkEndId(link.target) === activeId
    },
    [activeId]
  )

  const zoomBy = (factor: number) => {
    const fg = fgRef.current
    if (!fg) return
    fg.zoom(fg.zoom() * factor, 250)
  }

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4 text-xs">
          <LegendDot color="#22d3ee" label="Function" />
          <LegendDot color="#a855f7" label="Class" />
          <LegendDot color="#22c55e" label="Module" />
          {highlightModule && (
            <span className="flex items-center gap-1.5 text-[var(--color-neon-green)]">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-[var(--color-neon-green)]" />
              Just analyzed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {graphData.nodes.length > 0 && (
            <span className="text-xs text-gray-400">
              {graphData.nodes.length} nodes &middot; {graphData.links.length} relationships
            </span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="px-3 py-1 text-xs rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30
                         hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative border border-cyan-500/20 rounded-lg overflow-hidden"
        style={{ height, background: 'radial-gradient(circle at 50% 40%, #12121a 0%, #0a0a0f 80%)' }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin text-4xl text-cyan-400">&#9676;</div>
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-3">&#128376;</div>
              <p>No graph data yet</p>
              <p className="text-sm mt-1">Run an analysis to build the knowledge graph</p>
            </div>
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            width={width}
            height={height}
            backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={120}
            d3VelocityDecay={0.28}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={paintPointerArea}
            linkColor={(l: ForceLink) => (isLinkActive(l) ? (l.color || '#6b7280') : 'rgba(120,120,140,0.08)')}
            linkWidth={(l: ForceLink) => (isLinkActive(l) && activeId ? 2 : 1)}
            linkDirectionalParticles={(l: ForceLink) => (isLinkActive(l) ? 2 : 0)}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleColor={(l: ForceLink) => l.color || '#22d3ee'}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            onNodeHover={(n: PositionedNode | null) => setHoverId(n ? n.id : null)}
            onNodeClick={(n: PositionedNode) => {
              setSelected(n)
              onNodeSelect?.(n)
            }}
            onBackgroundClick={() => setSelected(null)}
          />
        )}

        {/* Zoom controls */}
        {graphData.nodes.length > 0 && !loading && (
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            <ZoomButton label="+" onClick={() => zoomBy(1.3)} />
            <ZoomButton label="-" onClick={() => zoomBy(1 / 1.3)} />
            <ZoomButton label="&#8962;" onClick={() => fgRef.current?.zoomToFit(400, 60)} />
          </div>
        )}

        {/* Selected node detail panel */}
        {selected && (
          <div className="absolute bottom-3 left-3 p-3 bg-[rgba(10,10,15,0.92)] border border-cyan-500/40 rounded-lg max-w-xs backdrop-blur">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selected.color, boxShadow: `0 0 8px ${selected.color}` }} />
              <span className="font-medium text-gray-100 truncate">{selected.label}</span>
              <button onClick={() => setSelected(null)} className="ml-auto text-gray-500 hover:text-white">&times;</button>
            </div>
            <div className="text-xs text-gray-400 space-y-1">
              <div>Type: <span className="text-cyan-300">{selected.type}</span></div>
              <div className="truncate">Module: <span className="text-gray-300">{selected.module || '-'}</span></div>
              {selected.class && <div>Class: <span className="text-purple-300">{selected.class}</span></div>}
              {selected.docstring && <div className="text-gray-500 line-clamp-3 mt-1">{selected.docstring}</div>}
            </div>
            {onNodeSelect && (
              <button
                onClick={() => onNodeSelect(selected)}
                className="mt-2 w-full text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-300
                           border border-purple-500/30 hover:bg-purple-500/30"
              >
                Query dependencies &rarr;
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Drag to move &middot; scroll to zoom &middot; hover to trace neighbours &middot; click a node for details
      </p>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-gray-400">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
    </span>
  )
}

function ZoomButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center bg-[rgba(18,18,26,0.9)] border border-cyan-500/30
                 rounded text-gray-300 hover:text-white hover:border-cyan-500/60"
      dangerouslySetInnerHTML={{ __html: label }}
    />
  )
}
