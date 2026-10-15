/**
 * 模糊匹配。
 *
 * 用途是"快速打开"：用户敲几个字母，从一长串文件路径里挑出想要的。
 *
 * ## 为什么打分而不是简单过滤
 *
 * 只做"子序列能不能匹配上"的话，敲 `md` 会把几百个文件全列出来，
 * 而用户想要的往往排在最后。所以匹配之外还要**排序**，
 * 而排序质量取决于几个很具体的偏好：
 *
 *   - **连续匹配**优于散落匹配（`abc` 命中 `abc.md` 好过 `a_b_c.md`）
 *   - **词首**优于词中（`r` 命中 `README` 好过 `error`）
 *   - **路径末段**优于目录名（用户记的是文件名，不是它所在的目录）
 *   - **越靠前**越好
 *
 * 这些偏好不是凭感觉定的：没有它们，敲三个字母出来的第一条
 * 往往不是想要的那个，用户就得用方向键找——那还不如直接翻文件树。
 */

/** 匹配上时返回分数（越大越好），匹配不上返回 null。 */
export function 模糊评分(查询: string, 文本: string): number | null {
  if (查询.length === 0) return 0
  if (查询.length > 文本.length) return null

  const 低查询 = 查询.toLowerCase()
  const 低文本 = 文本.toLowerCase()

  // 完全包含时给一个很高的底分：这是最强的信号，不该被字符级评分超过
  const 直接位置 = 低文本.indexOf(低查询)
  if (直接位置 >= 0) {
    return 1000 + 连续奖励(文本, 直接位置, 查询.length) - 直接位置
  }

  // 退化到子序列匹配
  let 分 = 0
  let 文本位置 = 0
  let 上次匹配 = -1

  for (const 字符 of 低查询) {
    const 找到 = 低文本.indexOf(字符, 文本位置)
    if (找到 < 0) return null

    if (找到 === 上次匹配 + 1) 分 += 8 // 连续
    if (是词首(文本, 找到)) 分 += 6
    分 -= Math.min(找到 - 文本位置, 4) // 跳过的字符越多扣得越多，但有上限

    上次匹配 = 找到
    文本位置 = 找到 + 1
  }

  // 匹配跨度越短越好
  分 -= Math.floor((上次匹配 - (文本位置 - 查询.length)) / 4)
  return 分
}

/** 该位置是不是一个词的开始（串首、分隔符之后、或小写转大写处）。 */
function 是词首(文本: string, 位置: number): boolean {
  if (位置 === 0) return true
  const 前 = 文本[位置 - 1]
  if (/[\s\-_/.\\]/.test(前)) return true
  // camelCase：小写后面跟大写
  return /[a-z]/.test(前) && /[A-Z]/.test(文本[位置])
}

/** 连续匹配的奖励：连着命中越多，加分越高。 */
function 连续奖励(文本: string, 位置: number, 长度: number): number {
  let 分 = 长度 * 2
  if (是词首(文本, 位置)) 分 += 10
  return 分
}

export interface 候选<T> {
  条目: T
  /** 用于匹配的文本（通常是完整路径）。 */
  文本: string
}

/**
 * 按查询筛选并排序。
 *
 * @param 取末段 从候选文本里取"用户实际在找的那一段"（通常是文件名）。
 *              末段命中要额外加分——用户记的是文件名，不是目录。
 */
export function 模糊筛选<T>(
  查询: string,
  候选们: 候选<T>[],
  取末段: (文本: string) => string,
  上限 = 50
): T[] {
  if (查询.trim().length === 0) {
    return 候选们.slice(0, 上限).map((c) => c.条目)
  }

  const 查询段 = 查询.trim()
  const 命中: { 条目: T; 分: number }[] = []

  for (const 候选 of 候选们) {
    const 整体分 = 模糊评分(查询段, 候选.文本)
    const 段分 = 模糊评分(查询段, 取末段(候选.文本))

    // 两处都不匹配就淘汰
    if (整体分 === null && 段分 === null) continue

    // 末段命中权重更高：同样匹配上，文件名对得上的一定更接近用户意图
    const 分 = (段分 ?? 0) * 3 + (整体分 ?? 0)
    命中.push({ 条目: 候选.条目, 分 })
  }

  命中.sort((甲, 乙) => 乙.分 - 甲.分)
  return 命中.slice(0, 上限).map((h) => h.条目)
}

/** 从路径里取文件名。 */
export function 路径末段(路径: string): string {
  const 段 = 路径.split(/[\\/]/)
  return 段[段.length - 1] || 路径
}
