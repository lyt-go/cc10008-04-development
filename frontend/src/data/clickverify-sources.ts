import { allRows, listRows } from './local-store'
import type { EntryRow } from './types'
import { parseClickEvents, parseSessionBoundary } from './clickchain'
import type { ClickEvent, SessionBoundary } from './clickverify-types'

/**
 * 跨模块数据流：会话重放（session）与点击流（clickstream）两个业务面在「会话事件
 * 序列入口」共用同一份读取逻辑。本文件是两个业务面唯一的取数口，页面和核验服务
 * 都从这里拿会话记录来源、会话事件序列来源，不再各自拼装。
 */

/**
 * 来源页面现有入口表：登记每个页面上能形成稳定业务结果的入口元素。
 * 核验时点击元素不在表内即判「入口缺失」——现有入口不能形成稳定业务结果。
 */
export const STABLE_ENTRY_TABLE: Record<string, string[]> = {
  '/home': ['搜索框', '分类导航', '活动横幅'],
  '/search': ['筛选器', '商品卡片', '排序按钮'],
  '/product': ['加入购物车按钮', '立即购买按钮', '规格选择器'],
  '/cart': ['结算按钮', '数量编辑框', '优惠券入口'],
  '/pay': ['支付方式选择', '确认支付按钮'],
  // /profile/loyalty 故意不登记：模拟来源页面入口缺失，点击无法形成稳定业务结果。
}

/** 会话记录来源定位（会话重放业务面）。 */
export function findSessionRow(sessionCode: string): EntryRow | undefined {
  return listRows('session').find((row) => String(row['会话编号']) === sessionCode)
}

/** 会话事件序列来源定位（点击流业务面）。 */
export function findClickstreamRow(sequenceCode: string): EntryRow | undefined {
  return listRows('clickstream').find((row) => String(row['序列编号']) === sequenceCode)
}

/** 读取会话记录上的时间边界，读不到时返回 null。 */
export function readSessionBoundary(sessionCode: string): SessionBoundary | null {
  return parseSessionBoundary(findSessionRow(sessionCode))
}

/** 读取点击序列上的逐点击事件（会话事件序列来源）。 */
export function readClickEvents(sequenceCode: string): ClickEvent[] {
  return parseClickEvents(findClickstreamRow(sequenceCode))
}

/** 会话记录来源描述，写进报告供回溯。 */
export function describeSessionSource(sessionCode: string): string {
  const row = findSessionRow(sessionCode)
  if (!row) {
    return `会话重放/会话记录:${sessionCode}（来源缺失）`
  }
  return `会话重放/会话记录:${sessionCode}#id=${row.id}/状态=${row.status}`
}

/** 会话事件序列来源描述，写进报告供回溯。 */
export function describeEventSequenceSource(sequenceCode: string): string {
  const row = findClickstreamRow(sequenceCode)
  if (!row) {
    return `点击流/点击序列:${sequenceCode}（来源缺失）`
  }
  const count = parseClickEvents(row).length
  return `点击流/点击序列:${sequenceCode}#id=${row.id}/状态=${row.status}/事件数=${count}`
}

/**
 * 丢掉 local-store 的内存缓存重新从 localStorage 读取。
 * 重置模块（resetRows）后缓存可能与新存储不一致，核验服务提交前调用一次。
 */
export function refreshSourceCache(): Record<string, EntryRow[]> {
  return allRows(true)
}
