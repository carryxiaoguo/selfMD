import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RecentEntry } from '@shared/types'
import { parseJsonc } from '../util/jsonc'
import { getAppPaths } from '../util/paths'

/**
 * 最近打开的文件 / 位置。
 *
 * 通行做法把它保存在 `<userData>/history.data` 与 `<userData>/profile.data`
 * （两者都存在于磁盘上——期间实测）。我们改用可读的 JSON 文件，
 * 这样可以人工查看和修复。
 */

const MAX_ENTRIES = 50

let entries: RecentEntry[] = []
let loaded = false

function file(): string {
  return join(getAppPaths().conf, 'recent.json')
}

interface Persisted {
  files?: RecentEntry[]
  folders?: RecentEntry[]
}

let folders: RecentEntry[] = []

export function loadRecent(): void {
  const path = file()
  entries = []
  folders = []
  if (existsSync(path)) {
    try {
      const data = parseJsonc<Persisted>(readFileSync(path, 'utf8'), {})
      entries = Array.isArray(data.files) ? data.files.filter(valid) : []
      folders = Array.isArray(data.folders) ? data.folders.filter(valid) : []
    } catch {
      entries = []
      folders = []
    }
  }
  loaded = true
}

function valid(e: unknown): e is RecentEntry {
  return (
    !!e &&
    typeof e === 'object' &&
    typeof (e as RecentEntry).path === 'string' &&
    (e as RecentEntry).path.length > 0
  )
}

function ensure(): void {
  if (!loaded) loadRecent()
}

function persist(): void {
  const path = file()
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify({ files: entries, folders }, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    console.error('[recent] persist failed:', err)
  }
}

/** 置顶项在前（最近的排在前面），其余按最近打开时间排序。 */
function sort(list: RecentEntry[]): RecentEntry[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.openedAt - a.openedAt
  })
}

export function listRecent(): RecentEntry[] {
  ensure()
  return sort(entries)
}

export function listRecentFolders(): RecentEntry[] {
  ensure()
  return sort(folders)
}

export function addRecent(path: string): RecentEntry[] {
  ensure()
  const now = Date.now()
  const existing = entries.find((e) => e.path === path)
  if (existing) {
    existing.openedAt = now
  } else {
    entries.unshift({ path, openedAt: now, pinned: false })
  }
  entries = sort(entries).slice(0, MAX_ENTRIES)
  persist()
  return listRecent()
}

export function addRecentFolder(path: string): RecentEntry[] {
  ensure()
  const now = Date.now()
  const existing = folders.find((e) => e.path === path)
  if (existing) existing.openedAt = now
  else folders.unshift({ path, openedAt: now, pinned: false })
  folders = sort(folders).slice(0, MAX_ENTRIES)
  persist()
  return listRecentFolders()
}

export function pinRecent(path: string, pinned: boolean): RecentEntry[] {
  ensure()
  const entry = entries.find((e) => e.path === path) ?? folders.find((e) => e.path === path)
  if (entry) entry.pinned = pinned
  persist()
  return listRecent()
}

export function removeRecent(path: string): RecentEntry[] {
  ensure()
  entries = entries.filter((e) => e.path !== path)
  folders = folders.filter((e) => e.path !== path)
  persist()
  return listRecent()
}

export function clearRecent(includePinned: boolean): RecentEntry[] {
  ensure()
  const keep = (e: RecentEntry) => includePinned && e.pinned
  entries = entries.filter(keep)
  folders = folders.filter(keep)
  persist()
  return listRecent()
}
