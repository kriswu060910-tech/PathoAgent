/**
 * 用户认证与配置管理。
 *
 * 每个用户拥有独立的 API 配置（AppSettings），登录后自动加载。
 * 用户数据（含密码哈希）存储在 localStorage 中。
 *
 * 安全说明：
 * - 密码使用 Web Crypto API (SHA-256 + 随机 salt) 哈希存储
 * - 会话有效期 7 天，过期自动登出
 * - 注意：localStorage 对同源 JS 可见，此方案适用于单用户桌面应用，
 *   不适用于多租户或高安全场景
 */

import { type AppSettings, DEFAULT_SETTINGS, updateSettings, resetSettings, onSettingsPersist } from './settings'

const USERS_KEY = 'cookie-agent-users'
const SESSION_KEY = 'cookie-agent-session'
const SESSION_EXPIRY_KEY = 'cookie-agent-session-expiry'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天

export interface UserProfile {
  username: string
  passwordHash: string
  salt: string
  displayName: string
  settings: AppSettings
  createdAt: number
}

interface UsersStore {
  [username: string]: UserProfile
}

function loadUsers(): UsersStore {
  try {
    const raw = localStorage.getItem(USERS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveUsers(users: UsersStore) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function loadSession(): string | null {
  const username = localStorage.getItem(SESSION_KEY)
  if (!username) return null

  const expiryStr = localStorage.getItem(SESSION_EXPIRY_KEY)
  if (expiryStr) {
    const expiry = parseInt(expiryStr, 10)
    if (Date.now() > expiry) {
      // 会话已过期，清除
      localStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(SESSION_EXPIRY_KEY)
      return null
    }
  }
  return username
}

function saveSession(username: string) {
  localStorage.setItem(SESSION_KEY, username)
  localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + SESSION_TTL_MS))
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(SESSION_EXPIRY_KEY)
}

// --- 密码哈希 (Web Crypto API) ---

function generateSalt(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(salt + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 向后兼容：验证旧版 simpleHash 格式的密码。
 * 旧格式为 `h_<base36>_<length>`，验证成功后自动迁移为 SHA-256。
 */
async function verifyAndUpgradePassword(
  password: string,
  profile: UserProfile,
): Promise<boolean> {
  // 新版 SHA-256 验证
  if (profile.salt) {
    const hash = await hashPassword(password, profile.salt)
    return hash === profile.passwordHash
  }

  // 旧版 simpleHash 兼容
  const legacyHash = simpleLegacyHash(password)
  if (legacyHash !== profile.passwordHash) return false

  // 验证通过，静默升级为 SHA-256
  const newSalt = generateSalt()
  const newHash = await hashPassword(password, newSalt)
  profile.passwordHash = newHash
  profile.salt = newSalt
  const users = loadUsers()
  users[profile.username] = profile
  saveUsers(users)
  return true
}

/** 旧版哈希函数，仅用于迁移验证 */
function simpleLegacyHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `h_${Math.abs(hash).toString(36)}_${str.length}`
}

// --- 认证状态管理 ---

let currentUser: UserProfile | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

let initialized = false

function init() {
  if (initialized) return
  initialized = true

  onSettingsPersist((s) => {
    if (currentUser) {
      currentUser = { ...currentUser, settings: s }
      const users = loadUsers()
      users[currentUser.username] = currentUser
      saveUsers(users)
    }
  })

  const sessionUser = loadSession()
  if (sessionUser) {
    const users = loadUsers()
    if (users[sessionUser]) {
      currentUser = users[sessionUser]
      updateSettings(currentUser.settings)
    }
  }
}

export function subscribeAuth(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getCurrentUser(): UserProfile | null {
  return currentUser
}

export function isLoggedIn(): boolean {
  return currentUser !== null
}

export async function register(
  username: string,
  password: string,
  displayName: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmedUser = username.trim().toLowerCase()
  if (!trimmedUser) return { ok: false, error: '用户名不能为空' }
  if (trimmedUser.length < 2) return { ok: false, error: '用户名至少 2 个字符' }
  if (!password || password.length < 4) return { ok: false, error: '密码至少 4 个字符' }

  const users = loadUsers()
  if (users[trimmedUser]) return { ok: false, error: '用户名已存在' }

  const salt = generateSalt()
  const passwordHash = await hashPassword(password, salt)

  const profile: UserProfile = {
    username: trimmedUser,
    passwordHash,
    salt,
    displayName: displayName.trim() || trimmedUser,
    settings: { ...DEFAULT_SETTINGS },
    createdAt: Date.now(),
  }
  users[trimmedUser] = profile
  saveUsers(users)

  currentUser = profile
  saveSession(trimmedUser)
  updateSettings(profile.settings)
  notify()
  return { ok: true }
}

export async function login(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmedUser = username.trim().toLowerCase()
  const users = loadUsers()
  const user = users[trimmedUser]
  if (!user) return { ok: false, error: '用户不存在' }

  const valid = await verifyAndUpgradePassword(password, user)
  if (!valid) return { ok: false, error: '密码错误' }

  currentUser = user
  saveSession(trimmedUser)
  updateSettings(user.settings)
  notify()
  return { ok: true }
}

export function logout() {
  if (currentUser) {
    const users = loadUsers()
    users[currentUser.username] = currentUser
    saveUsers(users)
  }
  currentUser = null
  clearSession()
  resetSettings()
  notify()
}

init()
