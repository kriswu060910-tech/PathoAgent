/**
 * 用户认证与配置管理。
 *
 * 优先使用远程认证服务（FastAPI + SQLite），支持跨设备登录。
 * 远程不可用时降级为 localStorage 本地模式。
 *
 * 远程模式：
 * - 登录/注册 → POST /auth/login, /auth/register
 * - 设置同步 → GET/PUT /auth/settings
 * - JWT 令牌存 localStorage，7 天过期
 *
 * 本地模式（降级）：
 * - 用户数据存 localStorage，仅当前设备可用
 */

import { type AppSettings, DEFAULT_SETTINGS, updateSettings, updateSettingsInMemory, resetSettings, onSettingsPersist, getSettings } from './settings'

const SESSION_KEY = 'cookie-agent-session'
const SESSION_TOKEN_KEY = 'cookie-agent-token'
const SESSION_EXPIRY_KEY = 'cookie-agent-session-expiry'
const SESSION_ROLE_KEY = 'cookie-agent-role'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天
const LOCAL_USERS_KEY = 'cookie-agent-users'

export interface UserProfile {
  username: string
  displayName: string
  settings: AppSettings
  /** 远程模式为 true，本地模式为 false */
  remote: boolean
  /** 用户角色：admin 或 user */
  role: string
}

// --- 远程 API 调用 ---

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'HttpError'
  }
}

function getAuthUrl(): string {
  return getSettings().authApiUrl || '/api/auth'
}

async function apiCall(path: string, options?: { method?: string; body?: Record<string, unknown>; token?: string }): Promise<Record<string, unknown>> {
  const method = options?.method || (options?.body ? 'POST' : 'GET')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options?.token) headers['Authorization'] = `Bearer ${options.token}`
  const res = await fetch(`${getAuthUrl()}${path}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new HttpError(res.status, (data as Record<string, string>).detail || `请求失败 (${res.status})`)
  }
  return res.json()
}

async function remoteRegister(username: string, password: string, displayName: string, adminKey?: string) {
  const data = await apiCall('/auth/register', { body: { username, password, displayName, adminKey: adminKey || '' } })
  return { token: data.token as string, username: data.username as string, displayName: data.displayName as string, role: data.role as string || 'user' }
}

async function remoteLogin(username: string, password: string) {
  const data = await apiCall('/auth/login', { body: { username, password } })
  return { token: data.token as string, username: data.username as string, displayName: data.displayName as string, role: data.role as string || 'user' }
}

async function remoteFetchSettings(token: string): Promise<AppSettings | null> {
  try {
    const data = await apiCall('/auth/settings', { token })
    const settings = data.settings as Record<string, string>
    if (settings && Object.keys(settings).length > 0) {
      return { ...DEFAULT_SETTINGS, ...settings } as AppSettings
    }
  } catch { /* ignore */ }
  return null
}

let _lastSyncError = ''
export function getSyncError(): string { return _lastSyncError }
export function clearSyncError() { _lastSyncError = '' }

async function remoteSaveSettings(token: string, settings: AppSettings) {
  try {
    const res = await fetch(`${getAuthUrl()}/auth/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ settings }),
    })
    if (res.status === 401) {
      clearSession()
    } else if (!res.ok) {
      _lastSyncError = '设置同步到服务器失败'
    } else {
      _lastSyncError = ''
    }
  } catch {
    _lastSyncError = '设置同步失败，仅保存在本地'
  }
}

// --- 本地降级模式 ---

interface LocalUser {
  username: string
  passwordHash: string
  salt: string
  displayName: string
  settings: AppSettings
  createdAt: number
  role: string
}

function loadLocalUsers(): Record<string, LocalUser> {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveLocalUsers(users: Record<string, LocalUser>) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users))
}

async function localHash(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 600_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  const arr = new Uint8Array(derived)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** @deprecated 仅用于旧密码迁移，新注册不使用 */
function legacyHash(password: string, salt: string): string {
  let h = 0
  const s = salt + password
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return `h_${Math.abs(h).toString(36)}_${s.length}`
}

function localGenerateSalt(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

// --- 会话管理 ---

let currentUser: UserProfile | null = null
let currentToken: string | null = null
const listeners = new Set<() => void>()

function notify() { listeners.forEach((fn) => fn()) }

function loadSession(): { username: string; token: string | null; remote: boolean; role: string } | null {
  const username = localStorage.getItem(SESSION_KEY)
  if (!username) return null
  const expiry = localStorage.getItem(SESSION_EXPIRY_KEY)
  if (expiry && Date.now() > parseInt(expiry, 10)) {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(SESSION_EXPIRY_KEY)
    localStorage.removeItem(SESSION_ROLE_KEY)
    return null
  }
  const token = localStorage.getItem(SESSION_TOKEN_KEY)
  const remote = !!token
  const role = localStorage.getItem(SESSION_ROLE_KEY) || 'user'
  return { username, token, remote, role }
}

function saveSession(username: string, token: string | null, role: string = 'user') {
  localStorage.setItem(SESSION_KEY, username)
  if (token) localStorage.setItem(SESSION_TOKEN_KEY, token)
  else localStorage.removeItem(SESSION_TOKEN_KEY)
  localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + SESSION_TTL_MS))
  localStorage.setItem(SESSION_ROLE_KEY, role)
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(SESSION_TOKEN_KEY)
  localStorage.removeItem(SESSION_EXPIRY_KEY)
  localStorage.removeItem(SESSION_ROLE_KEY)
}

// --- 初始化 ---

let initialized = false

function init() {
  if (initialized) return
  initialized = true

  // 设置变更时同步到远程
  onSettingsPersist((s) => {
    if (currentUser?.remote && currentToken) {
      remoteSaveSettings(currentToken, s)
    }
    if (currentUser) {
      currentUser = { ...currentUser, settings: s }
    }
  })

  // 恢复会话
  const session = loadSession()
  if (session) {
    if (session.remote && session.token) {
      // 远程模式：先从 localStorage 加载上次缓存的设置作为兜底
      const cachedSettings = getSettings()
      currentUser = { username: session.username, displayName: session.username, settings: cachedSettings, remote: true, role: session.role }
      currentToken = session.token
      updateSettingsInMemory(cachedSettings)
      // 异步从服务端拉取最新设置
      remoteFetchSettings(session.token).then((settings) => {
        if (!currentUser || currentUser.username !== session.username) return
        if (settings) {
          currentUser = { ...currentUser, settings }
          updateSettings(settings)
          notify()
        }
      })
    } else {
      // 本地模式
      const users = loadLocalUsers()
      const user = users[session.username]
      if (user) {
        currentUser = { username: user.username, displayName: user.displayName, settings: user.settings, remote: false, role: user.role || 'user' }
        updateSettings(user.settings)
      }
    }
  }
}

// --- 公开 API ---

export function subscribeAuth(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getCurrentUser(): UserProfile | null { return currentUser }
export function isLoggedIn(): boolean { return currentUser !== null }

export async function register(username: string, password: string, displayName: string, adminKey?: string): Promise<{ ok: boolean; error?: string }> {
  const trimmedUser = username.trim().toLowerCase()
  if (!trimmedUser) return { ok: false, error: '用户名不能为空' }
  if (trimmedUser.length < 2) return { ok: false, error: '用户名至少 2 个字符' }
  if (!password || password.length < 8) return { ok: false, error: '密码至少 8 个字符' }

  // 尝试远程注册
  try {
    const result = await remoteRegister(trimmedUser, password, displayName, adminKey)
    currentToken = result.token
    currentUser = { username: result.username, displayName: result.displayName, settings: { ...DEFAULT_SETTINGS }, remote: true, role: result.role }
    saveSession(result.username, result.token, result.role)
    updateSettings(currentUser.settings)
    notify()
    return { ok: true }
  } catch (err) {
    if (err instanceof HttpError) {
      return { ok: false, error: err.message }
    }
    // 远程不可用（网络错误），降级为本地注册
  }

  // 本地注册
  const users = loadLocalUsers()
  if (users[trimmedUser]) return { ok: false, error: '用户名已存在' }
  const salt = localGenerateSalt()
  const profile: LocalUser = {
    username: trimmedUser,
    passwordHash: await localHash(password, salt),
    salt,
    displayName: displayName.trim() || trimmedUser,
    settings: { ...DEFAULT_SETTINGS },
    createdAt: Date.now(),
    role: 'user',
  }
  users[trimmedUser] = profile
  saveLocalUsers(users)
  currentUser = { username: profile.username, displayName: profile.displayName, settings: profile.settings, remote: false, role: 'user' }
  currentToken = null
  saveSession(trimmedUser, null, 'user')
  updateSettings(profile.settings)
  notify()
  return { ok: true }
}

export async function login(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const trimmedUser = username.trim().toLowerCase()

  // 尝试远程登录
  try {
    const result = await remoteLogin(trimmedUser, password)
    currentToken = result.token
    // 先用 localStorage 中缓存的设置（不触发持久化回调，避免覆盖服务端）
    const cachedSettings = getSettings()
    currentUser = { username: result.username, displayName: result.displayName, settings: cachedSettings, remote: true, role: result.role }
    saveSession(result.username, result.token, result.role)
    updateSettingsInMemory(cachedSettings)
    notify()
    // 异步拉取服务端设置
    remoteFetchSettings(result.token).then((settings) => {
      if (settings && currentUser?.username === result.username) {
        currentUser = { ...currentUser, settings }
        updateSettings(settings)
        notify()
      }
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof HttpError) {
      return { ok: false, error: err.message }
    }
    // 远程不可用（网络错误），降级为本地登录
  }

  // 本地登录
  const users = loadLocalUsers()
  const user = users[trimmedUser]
  if (!user) return { ok: false, error: '用户不存在（认证服务不可用）' }

  const newHash = await localHash(password, user.salt)
  if (newHash === user.passwordHash) {
    // PBKDF2 格式匹配，正常登录
  } else if (user.passwordHash.startsWith('h_')) {
    // 旧格式 — 用 legacyHash 验证，成功后升级到 PBKDF2
    if (legacyHash(password, user.salt) !== user.passwordHash) return { ok: false, error: '密码错误' }
    user.passwordHash = newHash
    users[trimmedUser] = user
    saveLocalUsers(users)
  } else {
    return { ok: false, error: '密码错误' }
  }

  currentUser = { username: user.username, displayName: user.displayName, settings: user.settings, remote: false, role: user.role || 'user' }
  currentToken = null
  saveSession(trimmedUser, null, user.role || 'user')
  updateSettings(user.settings)
  notify()
  return { ok: true }
}

export function logout() {
  if (currentUser && !currentUser.remote) {
    const users = loadLocalUsers()
    if (users[currentUser.username] && currentToken === null) {
      users[currentUser.username] = { ...users[currentUser.username], settings: getSettings() }
      saveLocalUsers(users)
    }
  }
  currentUser = null
  currentToken = null
  clearSession()
  resetSettings()
  notify()
}

export function isAdmin(): boolean {
  return currentUser?.role === 'admin'
}

// --- 管理员 API ---

export interface UserInfo {
  id: number
  username: string
  displayName: string
  role: string
  enabled: boolean
  createdAt: number
}

export async function fetchUsers(): Promise<UserInfo[]> {
  if (!currentToken) return []
  try {
    const data = await apiCall('/auth/admin/users', { token: currentToken })
    return data.users as UserInfo[]
  } catch {
    return []
  }
}

export async function deleteUser(userId: number): Promise<boolean> {
  if (!currentToken) return false
  try {
    await apiCall(`/auth/admin/users/${userId}`, { method: 'DELETE', token: currentToken })
    return true
  } catch {
    return false
  }
}

export async function updateUserRole(userId: number, role: string): Promise<boolean> {
  if (!currentToken) return false
  try {
    await apiCall(`/auth/admin/users/${userId}/role`, { method: 'PUT', body: { role }, token: currentToken })
    return true
  } catch {
    return false
  }
}

export async function resetUserPassword(userId: number, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (!currentToken) return { ok: false, error: '未登录' }
  try {
    await apiCall(`/auth/admin/users/${userId}/password`, { method: 'PUT', body: { newPassword }, token: currentToken })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function updateDisplayName(userId: number, displayName: string): Promise<boolean> {
  if (!currentToken) return false
  try {
    await apiCall(`/auth/admin/users/${userId}/display-name`, { method: 'PUT', body: { displayName }, token: currentToken })
    return true
  } catch {
    return false
  }
}

export async function updateUserEnabled(userId: number, enabled: boolean): Promise<boolean> {
  if (!currentToken) return false
  try {
    await apiCall(`/auth/admin/users/${userId}/enabled`, { method: 'PUT', body: { enabled }, token: currentToken })
    return true
  } catch {
    return false
  }
}

export interface UserSettingsData {
  user: { id: number; username: string; display_name: string; role: string; enabled: boolean; created_at: number }
  settings: Record<string, unknown>
}

export async function fetchUserSettings(userId: number): Promise<UserSettingsData | null> {
  if (!currentToken) return null
  try {
    const data = await apiCall(`/auth/admin/users/${userId}/settings`, { token: currentToken })
    return data as unknown as UserSettingsData
  } catch {
    return null
  }
}

export async function batchDeleteUsers(ids: number[]): Promise<{ ok: boolean; error?: string; deleted?: number }> {
  if (!currentToken) return { ok: false, error: '未登录' }
  try {
    const data = await apiCall('/auth/admin/batch/delete', { method: 'POST', body: { ids }, token: currentToken })
    return { ok: true, deleted: data.deleted as number }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function batchEnableUsers(ids: number[]): Promise<boolean> {
  if (!currentToken) return false
  try {
    await apiCall('/auth/admin/batch/enable', { method: 'POST', body: { ids }, token: currentToken })
    return true
  } catch {
    return false
  }
}

export async function batchDisableUsers(ids: number[]): Promise<{ ok: boolean; error?: string }> {
  if (!currentToken) return { ok: false, error: '未登录' }
  try {
    await apiCall('/auth/admin/batch/disable', { method: 'POST', body: { ids }, token: currentToken })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

init()
