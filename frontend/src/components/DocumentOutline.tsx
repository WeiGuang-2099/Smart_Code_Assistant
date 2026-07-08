import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/apiClient'
import type { OutlineItem } from '../types/document'

interface DocumentOutlineProps {
  documentId: number
  content?: string // optional: extract directly from Markdown content
  onNavigate?: (lineNumber: number) => void
}

export default function DocumentOutline({
  documentId,
  content,
  onNavigate,
}: DocumentOutlineProps) {
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  // Extract outline from Markdown content
  const extractOutlineFromContent = (markdown: string): OutlineItem[] => {
    const lines = markdown.split('\n')
    const headings: OutlineItem[] = []

    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        const level = match[1].length
        const text = match[2].trim()
        // generate anchor
        const anchor = text
          .toLowerCase()
          .replace(/[^\w\u4e00-\u9fff]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50) || `heading-${index}`

        headings.push({
          level,
          text,
          anchor,
          line_number: index + 1,
          children: [],
        })
      }
    })

    // Build tree structure
    return buildOutlineTree(headings)
  }

  // Build outline tree structure
  const buildOutlineTree = (headings: OutlineItem[]): OutlineItem[] => {
    if (headings.length === 0) return []

    const root: OutlineItem = { level: 0, text: '', anchor: '', line_number: 0, children: [] }
    const stack: OutlineItem[] = [root]

    for (const heading of headings) {
      // Find parent (last heading with a lower level than current)
      while (stack[stack.length - 1].level >= heading.level) {
        stack.pop()
      }

      stack[stack.length - 1].children.push(heading)
      stack.push(heading)
    }

    return root.children
  }

  useEffect(() => {
    if (content) {
      // Extract directly from content
      const extracted = extractOutlineFromContent(content)
      setOutline(extracted)
      setLoading(false)
    } else {
      // Fetch from API
      const fetchOutline = async () => {
        try {
          const response = await apiFetch(`/api/v1/documents/${documentId}/outline`)

          if (response.ok) {
            const data = await response.json()
            setOutline(data.outline || [])
          }
        } catch (error) {
          console.error('Failed to fetch outline:', error)
        } finally {
          setLoading(false)
        }
      }

      fetchOutline()
    }
  }, [documentId, content])

  const toggleExpand = (anchor: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(anchor)) {
        next.delete(anchor)
      } else {
        next.add(anchor)
      }
      return next
    })
  }

  const handleItemClick = (item: OutlineItem) => {
    if (item.children.length > 0) {
      toggleExpand(item.anchor)
    }
    if (onNavigate && item.line_number) {
      onNavigate(item.line_number)
    }
  }

  const renderOutlineItem = (item: OutlineItem, depth: number = 0) => {
    const hasChildren = item.children.length > 0
    const isExpanded = expandedItems.has(item.anchor)
    const indentStyle = { paddingLeft: `${depth * 16 + 8}px` }

    return (
      <div key={item.anchor}>
        <div
          className={`
            flex items-center gap-2 py-1.5 cursor-pointer
            text-sm transition-colors rounded
            hover:bg-cyan-500/10 hover:text-cyan-300
          `}
          style={indentStyle}
          onClick={() => handleItemClick(item)}
        >
          {/* Expand/collapse icon */}
          {hasChildren && (
            <span
              className={`text-xs text-gray-500 transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
            >
              ▶
            </span>
          )}
          {!hasChildren && <span className="w-3" />}

          {/* Level indicator */}
          <span
            className={`
              w-5 h-5 flex items-center justify-center rounded text-xs font-mono
              ${item.level === 1 ? 'bg-cyan-500/20 text-cyan-400' : ''}
              ${item.level === 2 ? 'bg-purple-500/20 text-purple-400' : ''}
              ${item.level === 3 ? 'bg-pink-500/20 text-pink-400' : ''}
              ${item.level >= 4 ? 'bg-gray-500/20 text-gray-400' : ''}
            `}
          >
            H{item.level}
          </span>

          {/* Heading text */}
          <span className="flex-1 truncate text-gray-300">{item.text}</span>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {item.children.map((child) => renderOutlineItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="cyber-card p-4">
        <div className="animate-pulse text-cyan-400 text-sm">Loading outline...</div>
      </div>
    )
  }

  if (outline.length === 0) {
    return (
      <div className="cyber-card p-4">
        <div className="text-gray-500 text-sm text-center">No headings found</div>
      </div>
    )
  }

  return (
    <div className="cyber-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
        <span className="text-cyan-400">📋</span>
        <h3 className="text-sm font-semibold text-cyan-300 tracking-wider">OUTLINE</h3>
      </div>

      {/* Outline Tree */}
      <div className="py-2 max-h-96 overflow-y-auto scrollbar-thin">
        {outline.map((item) => renderOutlineItem(item))}
      </div>
    </div>
  )
}
