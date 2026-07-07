import { useState, useEffect } from 'react'
import { userService } from '../services/userService'
import type { UserPreference, Theme, Language } from '../types/user'

interface PreferencesTabProps {
  token: string
}

export default function PreferencesTab({ token }: PreferencesTabProps) {
  const [preferences, setPreferences] = useState<UserPreference | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // Form state
  const [theme, setTheme] = useState<Theme>('dark')
  const [language, setLanguage] = useState<Language>('zh-CN')
  const [editorFontSize, setEditorFontSize] = useState(14)
  const [editorTheme, setEditorTheme] = useState('monokai')
  const [notificationEnabled, setNotificationEnabled] = useState(true)
  const [emailNotification, setEmailNotification] = useState(true)

  // Load preferences
  useEffect(() => {
    loadPreferences()
  }, [token])

  const loadPreferences = async () => {
    setLoading(true)
    setError('')

    try {
      const data = await userService.getUserPreferences(token)
      setPreferences(data)
      setTheme(data.theme as Theme)
      setLanguage(data.language as Language)
      setEditorFontSize(data.editor_font_size)
      setEditorTheme(data.editor_theme)
      setNotificationEnabled(data.notification_enabled)
      setEmailNotification(data.email_notification)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess(false)

    try {
      await userService.updateUserPreferences(token, {
        theme,
        language,
        editor_font_size: editorFontSize,
        editor_theme: editorTheme,
        notification_enabled: notificationEnabled,
        email_notification: emailNotification,
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin text-2xl neon-text">◌</div>
        <p className="text-gray-400 mt-2">Loading preferences...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Error/Success Messages */}
      {error && (
        <div className="p-4 border border-red-500/50 rounded bg-red-500/10 flex justify-between items-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 hover:text-white">✕</button>
        </div>
      )}

      {success && (
        <div className="p-4 border border-green-500/50 rounded bg-green-500/10 flex justify-between items-center">
          <p className="text-sm text-green-400">Preferences saved successfully!</p>
          <button onClick={() => setSuccess(false)} className="text-green-400 hover:text-white">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Appearance Settings */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-purple-400 border-b border-gray-700 pb-2">
            Appearance
          </h3>

          <SettingItem
            label="Theme"
            description="Choose your preferred color scheme"
          >
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="px-4 py-2 bg-gray-900/50 border border-purple-500/30 rounded text-gray-100 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="auto">Auto (System)</option>
            </select>
          </SettingItem>

          <SettingItem
            label="Language"
            description="Select your preferred language"
          >
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="px-4 py-2 bg-gray-900/50 border border-purple-500/30 rounded text-gray-100 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
            >
              <option value="zh-CN">Chinese (Simplified)</option>
              <option value="en-US">English</option>
            </select>
          </SettingItem>
        </div>

        {/* Editor Settings */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-purple-400 border-b border-gray-700 pb-2">
            Editor Settings
          </h3>

          <SettingItem
            label="Font Size"
            description="Editor text font size in pixels"
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={24}
                value={editorFontSize}
                onChange={(e) => setEditorFontSize(parseInt(e.target.value))}
                className="flex-1 accent-purple-500"
              />
              <span className="text-cyan-400 font-mono w-12 text-center">{editorFontSize}px</span>
            </div>
          </SettingItem>

          <SettingItem
            label="Editor Theme"
            description="Code editor color theme"
          >
            <select
              value={editorTheme}
              onChange={(e) => setEditorTheme(e.target.value)}
              className="px-4 py-2 bg-gray-900/50 border border-purple-500/30 rounded text-gray-100 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
            >
              <option value="monokai">Monokai</option>
              <option value="github-dark">GitHub Dark</option>
              <option value="dracula">Dracula</option>
              <option value="nord">Nord</option>
              <option value="solarized-dark">Solarized Dark</option>
            </select>
          </SettingItem>
        </div>

        {/* Notification Settings */}
        <div className="space-y-4 md:col-span-2">
          <h3 className="text-lg font-semibold text-purple-400 border-b border-gray-700 pb-2">
            Notifications
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSetting
              label="Enable Notifications"
              description="Show in-app notifications"
              checked={notificationEnabled}
              onChange={setNotificationEnabled}
            />

            <ToggleSetting
              label="Email Notifications"
              description="Receive updates via email"
              checked={emailNotification}
              onChange={setEmailNotification}
              disabled={!notificationEnabled}
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-gray-700">
        <button
          onClick={handleSave}
          disabled={saving}
          className="cyber-btn px-8 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderColor: 'var(--color-neon-green)', color: 'var(--color-neon-green)' }}
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  )
}

function SettingItem({
  label,
  description,
  children
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <label className="block text-sm font-medium text-gray-200">{label}</label>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      {children}
    </div>
  )
}

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
  disabled = false
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className={`flex items-center justify-between py-3 px-4 rounded border ${disabled ? 'border-gray-800 opacity-50' : 'border-gray-700'}`}>
      <div>
        <label className={`block text-sm font-medium ${disabled ? 'text-gray-500' : 'text-gray-200'}`}>
          {label}
        </label>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`
          relative w-12 h-6 rounded-full transition-colors
          ${checked ? 'bg-purple-500' : 'bg-gray-700'}
          ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
            ${checked ? 'translate-x-6' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  )
}
