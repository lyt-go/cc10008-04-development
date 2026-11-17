/**
 * 纯领域逻辑核对：点击核验规则与两种版本冲突仲裁做法。
 * 不依赖 localStorage，直接构造点击与边界。
 */
import {
  arbitrate,
  assertSingleAssignment,
  filterWithinWindow,
  parseClickEvents,
  summarizeChecks,
  verifyClickChain,
} from '@/data/clickchain'
import type { ClickEvent, SessionBoundary, StableEntryTable } from '@/data/clickchain'

let passCount = 0
let failCount = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passCount += 1
    console.log(`  ✓ ${name}`)
  } else {
    failCount += 1
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

const entries: StableEntryTable = {
  '/home': ['搜索框'],
  '/search': ['商品卡片'],
  '/product': ['加入购物车按钮'],
  '/cart': ['结算按钮'],
  '/pay': ['确认支付按钮'],
  // /profile/loyalty 缺入口
}

const boundary: SessionBoundary = {
  sessionCode: 'SESS-0002',
  startTime: '2026-09-02T08:00:00',
  endTime: '2026-09-02T08:30:00',
  pages: ['/home', '/search', '/product', '/cart', '/pay'],
}

function evt(partial: Partial<ClickEvent> & { clickCode: string; sourcePage: string; element: string }): ClickEvent {
  return {
    eventTime: '2026-09-02T08:10:00',
    batchNo: 'B1',
    sequenceCode: 'CLIC-0002',
    ...partial,
  }
}

console.log('一、verifyClickChain 逐点击核验（可回来源页面）')
{
  const events = [
    evt({ clickCode: 'C1', sourcePage: '/home', element: '搜索框', eventTime: '2026-09-02T08:02:00' }),
    // 入口缺失：页面有入口但不含该元素
    evt({ clickCode: 'C2', sourcePage: '/pay', element: '分享返现按钮', eventTime: '2026-09-02T08:05:00' }),
    // 入口缺失：页面在会话内但完全没有登记入口（模拟来源页面入口缺失）
    evt({ clickCode: 'C3', sourcePage: '/product', element: '积分兑换入口', eventTime: '2026-09-02T08:08:00' }),
    // 重复采集：C1 在另一批次再次上报
    evt({ clickCode: 'C1', sourcePage: '/home', element: '搜索框', eventTime: '2026-09-02T08:09:00', batchNo: 'B2' }),
    // 断链：来源页面不在会话访问页面
    evt({ clickCode: 'C4', sourcePage: '/outside', element: '结算按钮', eventTime: '2026-09-02T08:12:00' }),
  ]
  const checks = verifyClickChain('CLIC-0002', events, boundary, entries)
  check('逐条给出核验结论', checks.length === 5)
  check('入口缺失（元素不匹配）', checks[1].result === '入口缺失')
  check('入口缺失（页面无入口）并定位 sourceEntry', checks[2].result === '入口缺失'
    && checks[2].sourceEntry?.page === '/product'
    && checks[2].sourceEntry?.sequenceCode === 'CLIC-0002'
    && checks[2].sourceEntry?.clickIndex === 2)
  check('重复采集识别', checks[3].result === '重复采集' && checks[3].sourceEntry?.clickIndex === 3)
  check('断链识别（页面不在会话内）', checks[4].result === '断链')
  check('通过项不带 sourceEntry', checks[0].sourceEntry === null)
  const summary = summarizeChecks(checks)
  check('汇总数 5 条、1 通过、4 异常、链不完整',
    summary.total === 5 && summary.passed === 1 && summary.abnormal === 4 && summary.intact === false)
}

console.log('二、断链：页面次序回跳')
{
  const events = [
    evt({ clickCode: 'C1', sourcePage: '/cart', element: '结算按钮', eventTime: '2026-09-02T08:10:00' }),
    evt({ clickCode: 'C2', sourcePage: '/home', element: '搜索框', eventTime: '2026-09-02T08:12:00' }),
  ]
  const checks = verifyClickChain('CLIC-0002', events, boundary, entries)
  check('回跳点击判断链', checks[1].result === '断链' && checks[1].reason.includes('回跳'))
}

console.log('三、filterWithinWindow 窗口过滤')
{
  const events = [
    evt({ clickCode: 'C1', eventTime: '2026-09-02T07:59:00', sourcePage: '/home', element: '搜索框' }),
    evt({ clickCode: 'C2', eventTime: '2026-09-02T08:15:00', sourcePage: '/home', element: '搜索框' }),
    evt({ clickCode: 'C3', eventTime: '2026-09-02T08:31:00', sourcePage: '/home', element: '搜索框' }),
  ]
  const kept = filterWithinWindow(events, '2026-09-02T08:00:00', '2026-09-02T08:30:00')
  check('只保留窗口内点击', kept.length === 1 && kept[0].clickCode === 'C2')
}

console.log('四、按会话时间边界重组（跨会话拆分清单）')
{
  const boundaries: SessionBoundary[] = [
    { sessionCode: 'SESS-0002', startTime: '2026-09-02T08:00:00', endTime: '2026-09-02T08:30:00', pages: ['/home', '/pay'] },
    { sessionCode: 'SESS-0003', startTime: '2026-09-02T09:00:00', endTime: '2026-09-02T09:20:00', pages: ['/home'] },
  ]
  // CLIC-0002 原属 SESS-0002，但有一个点击时间落在相邻 SESS-0003 窗口
  const events = [
    evt({ clickCode: 'C1', eventTime: '2026-09-02T08:10:00', sourcePage: '/home', element: '搜索框' }),
    evt({ clickCode: 'C2', eventTime: '2026-09-02T09:05:00', sourcePage: '/home', element: '搜索框' }),
  ]
  const outcome = arbitrate('会话时间边界', events, boundaries, { 'CLIC-0002': 'SESS-0002' })
  check('生成两条已确认会话链', outcome.chains.length === 2)
  check('C1 归 SESS-0002', outcome.chains.find((c) => c.sessionCode === 'SESS-0002')?.clickCodes.join() === 'C1')
  check('C2 归 SESS-0003', outcome.chains.find((c) => c.sessionCode === 'SESS-0003')?.clickCodes.join() === 'C2')
  check('留下跨会话拆分清单', outcome.splitList.length === 1
    && outcome.splitList[0].clickCode === 'C2'
    && outcome.splitList[0].fromSession === 'SESS-0002'
    && outcome.splitList[0].toSession === 'SESS-0003')
  check('归并清单为空', outcome.mergeList.length === 0)
  check('每条点击唯一归属不变量成立', assertSingleAssignment(events, outcome.chains))
}

console.log('五、按采集批次边界重组（重复采集归并清单）')
{
  const boundaries: SessionBoundary[] = [
    { sessionCode: 'SESS-0002', startTime: '2026-09-02T08:00:00', endTime: '2026-09-02T08:30:00', pages: ['/home', '/pay'] },
  ]
  const events = [
    evt({ clickCode: 'C1', eventTime: '2026-09-02T08:10:00', batchNo: 'B1', sourcePage: '/home', element: '搜索框' }),
    evt({ clickCode: 'C1', eventTime: '2026-09-02T08:10:05', batchNo: 'B2', sourcePage: '/home', element: '搜索框' }),
    evt({ clickCode: 'C2', eventTime: '2026-09-02T08:12:00', batchNo: 'B1', sourcePage: '/pay', element: '确认支付按钮' }),
    evt({ clickCode: 'C2', eventTime: '2026-09-02T08:12:05', batchNo: 'B2', sourcePage: '/pay', element: '确认支付按钮' }),
  ]
  const outcome = arbitrate('采集批次边界', events, boundaries)
  check('重复点击归并后只保留最早批次', outcome.chains[0]?.clickCodes.sort().join() === 'C1,C2')
  check('留下重复采集归并清单 2 条', outcome.mergeList.length === 2)
  const c1Merge = outcome.mergeList.find((m) => m.clickCode === 'C1')
  check('C1 保留 B1、归并 B2', c1Merge?.keptBatch === 'B1' && c1Merge.droppedBatches.join() === 'B2')
  check('拆分清单为空', outcome.splitList.length === 0)
  check('归并后每条点击仍唯一归属', assertSingleAssignment(events, outcome.chains))
}

console.log('六、parseClickEvents 容错')
{
  check('无明细字段返回空数组', parseClickEvents(undefined).length === 0)
  check('坏 JSON 返回空数组', parseClickEvents({ id: 1, 点击明细: '{bad json' }).length === 0)
  check('正常 JSON 还原事件', parseClickEvents({ id: 1, 点击明细: '[{"clickCode":"X"}]' }).length === 1)
}

console.log(`\n领域逻辑：通过 ${passCount} 项，失败 ${failCount} 项`)
if (failCount > 0) {
  process.exitCode = 1
}
