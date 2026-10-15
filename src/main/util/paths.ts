import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { AppPaths } from '@shared/ipc'

/**
 * 用户数据根目录下的目录布局。
 *
 * 全部落在 `%APPDATA%\selfmd\` 下面，各类数据各占一个子目录：
 *
 *   conf/        配置
 *   themes/      主题（普通 .css 文件）
 *   backups/     备份
 *   drafts/      自动保存的草稿（崩溃恢复用）
 *   images/      没有归属文档的图片（剪贴板位图等）
 */
export const DIRS = {
  conf: 'conf',
  themes: 'themes',
  backups: 'backups',
  drafts: 'drafts',
  userImages: 'images',
  dictionaries: 'Dictionaries',
  sessions: 'sessions'
} as const

let cached: AppPaths | null = null

export function getAppPaths(): AppPaths {
  if (cached) return cached
  const userData = app.getPath('userData')
  cached = {
    userData,
    conf: join(userData, DIRS.conf),
    themes: join(userData, DIRS.themes),
    backups: join(userData, DIRS.backups),
    drafts: join(userData, DIRS.drafts),
    userImages: join(userData, DIRS.userImages),
    home: app.getPath('home'),
    documents: app.getPath('documents')
  }
  return cached
}

/** 创建应用需要的全部目录。幂等。 */
export function ensureAppDirs(): void {
  const p = getAppPaths()
  for (const dir of [p.conf, p.themes, p.backups, p.drafts, p.userImages]) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // 只读或受限的用户配置不能阻碍启动。
    }
  }
}
