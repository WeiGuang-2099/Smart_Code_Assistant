/**
 * Document API service for Raw materials library
 */
import type {
  Document,
  DocumentCreate,
  DocumentUpdate,
  DocumentDetail,
  DocumentListResponse,
  DocumentListParams,
  Version,
  VersionCreate,
  VersionListItem,
  VersionCompareResponse,
  VersionRollbackRequest,
  VersionRollbackResponse,
  PDFUploadResponse,
  TipTapContent,
} from '../types/document'
import { apiFetch } from '../lib/apiClient'


/**
 * Get authorization headers with token
 */
function getAuthHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

/**
 * Handle API response
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: 'An error occurred' }))
    throw new Error(data.detail || `HTTP ${response.status}`)
  }
  return response.json()
}

// ==================== Document API ====================

/**
 * Get paginated list of documents
 */
export async function getDocuments(
  token: string,
  params: DocumentListParams = {}
): Promise<DocumentListResponse> {
  const queryParams = new URLSearchParams()
  if (params.page) queryParams.append('page', params.page.toString())
  if (params.page_size) queryParams.append('page_size', params.page_size.toString())
  if (params.category) queryParams.append('category', params.category)
  if (params.project_id) queryParams.append('project_id', params.project_id.toString())
  if (params.search) queryParams.append('search', params.search)
  if (params.sort_by) queryParams.append('sort_by', params.sort_by)
  if (params.sort_order) queryParams.append('sort_order', params.sort_order)

  const response = await apiFetch(
    `/api/v1/documents?${queryParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  return handleResponse<DocumentListResponse>(response)
}

/**
 * Get a single document by ID
 */
export async function getDocument(token: string, documentId: number): Promise<DocumentDetail> {
  const response = await apiFetch(`/api/v1/documents/${documentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<DocumentDetail>(response)
}

/**
 * Create a new document
 */
export async function createDocument(
  token: string,
  data: DocumentCreate
): Promise<Document> {
  const response = await apiFetch(`/api/v1/documents`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<Document>(response)
}

/**
 * Update document metadata (title, description, category)
 */
export async function updateDocumentMetadata(
  token: string,
  documentId: number,
  data: DocumentUpdate
): Promise<Document> {
  const response = await apiFetch(`/api/v1/documents/${documentId}/metadata`, {
    method: 'PATCH',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<Document>(response)
}

/**
 * Update document content (creates a new version)
 */
export async function updateDocumentContent(
  token: string,
  documentId: number,
  data: VersionCreate
): Promise<Version> {
  const response = await apiFetch(`/api/v1/documents/${documentId}`, {
    method: 'PUT',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<Version>(response)
}

/**
 * Delete a document
 */
export async function deleteDocument(token: string, documentId: number): Promise<void> {
  const response = await apiFetch(`/api/v1/documents/${documentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: 'An error occurred' }))
    throw new Error(data.detail || `HTTP ${response.status}`)
  }
}

// ==================== Version API ====================

/**
 * Get all versions of a document
 */
export async function getVersions(
  token: string,
  documentId: number
): Promise<VersionListItem[]> {
  const response = await apiFetch(
    `/api/v1/documents/${documentId}/versions`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  return handleResponse<VersionListItem[]>(response)
}

/**
 * Get a specific version
 */
export async function getVersion(
  token: string,
  documentId: number,
  versionId: number
): Promise<Version> {
  const response = await apiFetch(
    `/api/v1/documents/${documentId}/versions/${versionId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  return handleResponse<Version>(response)
}

/**
 * Compare two versions
 */
export async function compareVersions(
  token: string,
  documentId: number,
  fromVersion: number,
  toVersion: number
): Promise<VersionCompareResponse> {
  const queryParams = new URLSearchParams({
    from_version: fromVersion.toString(),
    to_version: toVersion.toString(),
  })

  const response = await apiFetch(
    `/api/v1/documents/${documentId}/versions/compare?${queryParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  return handleResponse<VersionCompareResponse>(response)
}

/**
 * Rollback to a specific version
 */
export async function rollbackVersion(
  token: string,
  documentId: number,
  data: VersionRollbackRequest
): Promise<VersionRollbackResponse> {
  const response = await apiFetch(
    `/api/v1/documents/${documentId}/rollback`,
    {
      method: 'POST',
      headers: getAuthHeaders(token),
      body: JSON.stringify(data),
    }
  )

  return handleResponse<VersionRollbackResponse>(response)
}

// ==================== PDF Parsing API ====================

/**
 * Upload and parse a PDF file
 */
export async function uploadPDF(
  token: string,
  file: File,
  metadata?: {
    title?: string
    description?: string
    category?: string
  }
): Promise<PDFUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  if (metadata?.title) formData.append('title', metadata.title)
  if (metadata?.description) formData.append('description', metadata.description)
  if (metadata?.category) formData.append('category', metadata.category)

  const response = await apiFetch(`/api/v1/documents/parse/parse-pdf`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  })

  return handleResponse<PDFUploadResponse>(response)
}

/**
 * Convert Markdown to TipTap JSON
 */
export async function convertToTipTap(
  token: string,
  markdown: string
): Promise<{ tiptap: TipTapContent }> {
  const response = await apiFetch(`/api/v1/documents/parse/convert-to-tiptap`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({ markdown }),
  })

  return handleResponse<{ tiptap: TipTapContent }>(response)
}

/**
 * Convert TipTap JSON to Markdown
 */
export async function convertToMarkdown(
  token: string,
  tiptapJson: TipTapContent
): Promise<{ markdown: string }> {
  const response = await apiFetch(`/api/v1/documents/parse/convert-to-markdown`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(tiptapJson),
  })

  return handleResponse<{ markdown: string }>(response)
}

/**
 * Get PDF parsing service status
 */
export async function getParseStatus(token: string): Promise<Record<string, unknown>> {
  const response = await apiFetch(`/api/v1/documents/parse/parse-status`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<Record<string, unknown>>(response)
}

// ==================== Export as singleton object ====================

export const documentService = {
  // Documents
  getDocuments,
  getDocument,
  createDocument,
  updateDocumentMetadata,
  updateDocumentContent,
  deleteDocument,

  // Versions
  getVersions,
  getVersion,
  compareVersions,
  rollbackVersion,

  // PDF Parsing
  uploadPDF,
  convertToTipTap,
  convertToMarkdown,
  getParseStatus,
}
