import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { CONF_HEADER, parseJsonc } from '../util/jsonc'
import { getAppPaths } from '../util/paths'

/**
 * 设置存储。
 *
 * 以 JSONC 形式持久化到 `<userData>/conf/conf.user.json`，与 通行的磁盘布局
 * 保持一致。我们不认识的键会原样保留，这样用户手写的额外字段就能经受住
 * 一次往返。
 */

type Listener = (settings: Settings) => void

let current: Settings = { ...DEFAULT_SETTINGS }
let extras: Record<string, unknown> = {}
let loaded = false
const listeners = new Set<Listener>()

function confPath(): string {
  return join(getAppPaths().conf, 'conf.user.json')
}

function coerce(raw: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = raw[key as string]
    if (value === undefined) continue
    const expected = typeof DEFAULT_SETTINGS[key]
    // 只接受基本类型与默认值一致的值。这样可以避免手工编辑过的文件
    // 因为诸如 fontSize: "big" 之类的内容让应用崩溃。
    if (typeof value === expected || value === null) out[key as string] = value
  }
  return out as unknown as Settings
}

export function loadSettings(): Settings {
  const path = confPath()
  if (!existsSync(path)) {
    current = { ...DEFAULT_SETTINGS }
    extras = {}
    loaded = true
    saveSettings()
    return current
  }
  try {
    const text = readFileSync(path, 'utf8')
    const raw = parseJsonc<Record<string, unknown>>(text, {})
    current = coerce(raw)
    extras = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in DEFAULT_SETTINGS)) extras[k] = v
    }
  } catch {
    current = { ...DEFAULT_SETTINGS }
    extras = {}
  }
  loaded = true
  return current
}

function ensureLoaded(): Settings {
  if (!loaded) loadSettings()
  return current
}

export function getSettings(): Settings {
  return { ...ensureLoaded() }
}

/** 原子写：临时文件 + 改名，这样写入中途崩溃也不会截断配置文件。 */
export function saveSettings(): void {
  const path = confPath()
  const payload = { ...extras, ...current }
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, CONF_HEADER + JSON.stringify(payload, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[settings] failed to persist:', err)
  }
}

function notify(): void {
  const snapshot = getSettings()
  for (const fn of listeners) {
    try {
      fn(snapshot)
    } catch (err) {
      console.error('[settings] listener threw:', err)
    }
  }
}

export function onSettingsChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
  ensureLoaded()
  if (!(key in DEFAULT_SETTINGS)) {
    throw new Error(`[settings] unknown key: ${String(key)}`)
  }
  current[key] = value
  saveSettings()
  notify()
  return getSettings()
}

export function patchSettings(patch: Partial<Settings>): Settings {
  ensureLoaded()
  const mutable = current as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) mutable[k] = v
  }
  saveSettings()
  notify()
  return getSettings()
}

export function resetSettings(): Settings {
  current = { ...DEFAULT_SETTINGS }
  extras = {}
  saveSettings()
  notify()
  return getSettings()
}

export function settingsFilePath(): string {
  void app // 让 electron 的导入保持有意义，以控制路径解析的时机
  return confPath()
}
