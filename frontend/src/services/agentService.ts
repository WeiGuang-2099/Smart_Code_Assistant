/**
 * Agent (Digital Human) API service
 */
import type {
  Agent,
  AgentDetail,
  AgentCreate,
  AgentUpdate,
  AgentStatusUpdate,
  AgentListResponse,
  ConversationDetail,
  ConversationCreate,
  ConversationListResponse,
  TrainingTask,
  TrainingTaskCreate,
  TrainingTaskListResponse,
  AgentNameSuggestionRequest,
  AgentNameSuggestionResponse,
} from '../types/agent'
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

// ==================== Agent API ====================

/**
 * List all agents with pagination and filtering
 */
export async function getAgents(
  token: string,
  params?: {
    page?: number
    page_size?: number
    status?: string
    domain?: string
    search?: string
  }
): Promise<AgentListResponse> {
  const searchParams = new URLSearchParams()
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.page_size) searchParams.set('page_size', String(params.page_size))
  if (params?.status) searchParams.set('status', params.status)
  if (params?.domain) searchParams.set('domain', params.domain)
  if (params?.search) searchParams.set('search', params.search)

  const queryString = searchParams.toString()
  const url = `/api/v1/agents${queryString ? `?${queryString}` : ''}`

  const response = await apiFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<AgentListResponse>(response)
}

/**
 * Get a specific agent by ID
 */
export async function getAgent(token: string, agentId: number): Promise<AgentDetail> {
  const response = await apiFetch(`/api/v1/agents/${agentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<AgentDetail>(response)
}

/**
 * Create a new agent
 */
export async function createAgent(token: string, data: AgentCreate): Promise<Agent> {
  const response = await apiFetch(`/api/v1/agents`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<Agent>(response)
}

/**
 * Update an agent
 */
export async function updateAgent(
  token: string,
  agentId: number,
  data: AgentUpdate
): Promise<Agent> {
  const response = await apiFetch(`/api/v1/agents/${agentId}`, {
    method: 'PUT',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<Agent>(response)
}

/**
 * Update agent status
 */
export async function updateAgentStatus(
  token: string,
  agentId: number,
  data: AgentStatusUpdate
): Promise<Agent> {
  const response = await apiFetch(`/api/v1/agents/${agentId}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<Agent>(response)
}

/**
 * Delete an agent
 */
export async function deleteAgent(token: string, agentId: number): Promise<void> {
  const response = await apiFetch(`/api/v1/agents/${agentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: 'An error occurred' }))
    throw new Error(data.detail || `HTTP ${response.status}`)
  }
}

/**
 * Get conversations for an agent
 */
export async function getAgentConversations(
  token: string,
  agentId: number,
  params?: { page?: number; page_size?: number }
): Promise<ConversationListResponse> {
  const searchParams = new URLSearchParams()
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.page_size) searchParams.set('page_size', String(params.page_size))

  const queryString = searchParams.toString()
  const url = `/api/v1/agents/${agentId}/conversations${queryString ? `?${queryString}` : ''}`

  const response = await apiFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<ConversationListResponse>(response)
}

// ==================== Conversation API ====================

/**
 * Create a new conversation
 */
export async function createConversation(
  token: string,
  data: ConversationCreate
): Promise<ConversationDetail> {
  const response = await apiFetch(`/api/v1/conversations`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<ConversationDetail>(response)
}

/**
 * Get a conversation with messages
 */
export async function getConversation(
  token: string,
  conversationId: number
): Promise<ConversationDetail> {
  const response = await apiFetch(`/api/v1/conversations/${conversationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<ConversationDetail>(response)
}

/**
 * Delete a conversation
 */
export async function deleteConversation(token: string, conversationId: number): Promise<void> {
  const response = await apiFetch(`/api/v1/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: 'An error occurred' }))
    throw new Error(data.detail || `HTTP ${response.status}`)
  }
}

// ==================== Training Task API ====================

/**
 * List training tasks
 */
export async function getTrainingTasks(
  token: string,
  params?: { agent_id?: number; page?: number; page_size?: number }
): Promise<TrainingTaskListResponse> {
  const searchParams = new URLSearchParams()
  if (params?.agent_id) searchParams.set('agent_id', String(params.agent_id))
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.page_size) searchParams.set('page_size', String(params.page_size))

  const queryString = searchParams.toString()
  const url = `/api/v1/training-tasks${queryString ? `?${queryString}` : ''}`

  const response = await apiFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<TrainingTaskListResponse>(response)
}

/**
 * Create a new training task
 */
export async function createTrainingTask(
  token: string,
  data: TrainingTaskCreate
): Promise<TrainingTask> {
  const response = await apiFetch(`/api/v1/training-tasks`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<TrainingTask>(response)
}

/**
 * Get a specific training task
 */
export async function getTrainingTask(
  token: string,
  taskId: number
): Promise<TrainingTask> {
  const response = await apiFetch(`/api/v1/training-tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<TrainingTask>(response)
}

// ==================== AI Name Suggestion API ====================

/**
 * Get AI-powered agent name suggestions based on domain
 */
export async function suggestAgentName(
  token: string,
  data: AgentNameSuggestionRequest
): Promise<AgentNameSuggestionResponse> {
  const response = await apiFetch(`/api/v1/agents/suggest-name`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<AgentNameSuggestionResponse>(response)
}

// ==================== Export as singleton object ====================

export const agentService = {
  // Agents
  getAgents,
  getAgent,
  createAgent,
  updateAgent,
  updateAgentStatus,
  deleteAgent,
  getAgentConversations,

  // Conversations
  createConversation,
  getConversation,
  deleteConversation,

  // Training Tasks
  getTrainingTasks,
  createTrainingTask,
  getTrainingTask,

  // AI Suggestions
  suggestAgentName,
}
