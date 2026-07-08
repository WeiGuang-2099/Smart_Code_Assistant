/**
 * User profile and preference API service
 */
import type {
  UserProfile,
  UserProfileDetail,
  UserProfileUpdate,
  UserPreference,
  UserPreferenceUpdate,
  UserStats,
  EnhancedUserStats,
  FullUserProfile,
  AvatarUploadResponse,
} from '../types/user'
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

// ==================== User Profile API ====================

/**
 * Get current user's profile
 */
export async function getUserProfile(token: string): Promise<UserProfileDetail> {
  const response = await apiFetch(`/api/v1/user/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<UserProfileDetail>(response)
}

/**
 * Update current user's profile
 */
export async function updateUserProfile(
  token: string,
  data: UserProfileUpdate
): Promise<UserProfile> {
  const response = await apiFetch(`/api/v1/user/profile`, {
    method: 'PUT',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<UserProfile>(response)
}

/**
 * Upload avatar image
 */
export async function uploadAvatar(
  token: string,
  file: File
): Promise<AvatarUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await apiFetch(`/api/v1/user/profile/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  })

  return handleResponse<AvatarUploadResponse>(response)
}

// ==================== User Preference API ====================

/**
 * Get current user's preferences
 */
export async function getUserPreferences(token: string): Promise<UserPreference> {
  const response = await apiFetch(`/api/v1/user/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<UserPreference>(response)
}

/**
 * Update current user's preferences
 */
export async function updateUserPreferences(
  token: string,
  data: UserPreferenceUpdate
): Promise<UserPreference> {
  const response = await apiFetch(`/api/v1/user/preferences`, {
    method: 'PUT',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  })

  return handleResponse<UserPreference>(response)
}

// ==================== User Stats API ====================

/**
 * Get current user's statistics
 */
export async function getUserStats(token: string): Promise<UserStats> {
  const response = await apiFetch(`/api/v1/user/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<UserStats>(response)
}

/**
 * Get current user's enhanced statistics (including agent data)
 */
export async function getEnhancedUserStats(token: string): Promise<EnhancedUserStats> {
  const response = await apiFetch(`/api/v1/user/stats/enhanced`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<EnhancedUserStats>(response)
}

// ==================== Full Profile API ====================

/**
 * Get complete user profile (profile + preferences + stats)
 */
export async function getFullUserProfile(token: string): Promise<FullUserProfile> {
  const response = await apiFetch(`/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return handleResponse<FullUserProfile>(response)
}

// ==================== Export as singleton object ====================

export const userService = {
  // Profile
  getUserProfile,
  updateUserProfile,
  uploadAvatar,

  // Preferences
  getUserPreferences,
  updateUserPreferences,

  // Stats
  getUserStats,
  getEnhancedUserStats,

  // Full profile
  getFullUserProfile,
}
