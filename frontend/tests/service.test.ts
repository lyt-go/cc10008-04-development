/**
 * 端到端核对：用 SESS-0002 的完整提交、重复提交、相邻会话三种输入，
 * 验证报告生成、单份有效报告、冲突队列、仲裁清单与点击流异常来源定位。
 */
import './local-storage-shim'

import { resetClickverifyStorage } from '@/data/clickverify-store'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  archiveReport,
  listArbitrations,
  listConflictTasks,
  listIntegrityReports,
  listVerificationTasks,
  locateAbnormalSources,
  submitVerificationTask,
} from '@/api/clickverify-service'
import {
  describeEventSequenceSource,
  describeSessionSource,
  readClickEvents,
} from '@/data/clickverify-sources'
import { parseClickEvents } from '@/data/clickchain'
import type { EntryRow } from '@/data/types'

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

function fullReset(): void {
  resetClickverifyStorage()
  for (const key of ['session', 'clickstream', 'clickverify']) {
    resetRows(key)
  }
  allRows(true)
}

const WINDOW = {
  windowStart: '2026-09-02T08:00:00',
  windowEnd: '2026-09-02T08:30:00',
}

console.log('场景零、来源与跨模块数据流')
{
  fullReset()
  const sess2 = listRows('session').find((r) => r['会话编号'] === 'SESS-0002')
  const clic2 = listRows('clickstream').find((r) => r['序列编号'] === 'CLIC-0002')
  check('SESS-0002 会话记录来源存在', Boolean(sess2))
  check('CLIC-0002 点击序列来源存在', Boolean(clic2))
  check('点击明细含 8 条事件（含重复批次）', readClickEvents('CLIC-0002').length === 8)
  check('会话记录来源描述可回溯', describeSessionSource('SESS-0002').includes('会话重放/会话记录:SESS-0002'))
  check('会话事件序列来源描述可回溯', describeEventSequenceSource('CLIC-0002').includes('点击流/点击序列:CLIC-0002'))
}

console.log('\n场景一、SESS-0002 完整提交：生成一份有效报告')
{
  fullReset()
  const result = submitVerificationTask({
    sessionCode: 'SESS-0002',
    sequenceCode: 'CLIC-0002',
    scenario: '完整提交',
    ...WINDOW,
  })
  check('返回 generated', result.kind === 'generated')
  check('报告编号为 CVER-0001', result.reportCode === 'CVER-0001')

  const reports = listIntegrityReports()
  check('只生成一份报告', reports.length === 1)
  const report = reports[0]
  check('窗口内 8 条点击全部入报告', report.totalClicks === 8)
  check('存在异常（重复采集 + 入口缺失）', report.abnormalClicks > 0 && !report.chainIntact)
  check('报告状态为核验异常', report.status === '核验异常')
  check('保留会话记录来源', report.sessionSource.includes('SESS-0002'))
  check('保留会话事件序列来源', report.eventSequenceSource.includes('CLIC-0002'))

  const results = report.checkResults
  const dup = results.filter((r) => r.result === '重复采集')
  const missing = results.filter((r) => r.result === '入口缺失')
  check('识别 2 条重复采集（CLK-204、CLK-205）', dup.length === 2
    && dup.map((r) => r.clickCode).sort().join() === 'CLK-204,CLK-205')
  check('识别来源页面入口缺失（CLK-206 在 /pay 无稳定入口）',
    missing.length === 1 && missing[0].clickCode === 'CLK-206' && missing[0].sourcePage === '/pay')
  check('每条异常都能定位到点击流来源（页面#序列[下标]）',
    report.checkResults.filter((r) => r.result !== '通过').every((r) => r.sourceEntry?.sequenceCode === 'CLIC-0002'
      && typeof r.sourceEntry.clickIndex === 'number' && r.sourceEntry.page))

  // 点击流侧定位异常来源
  const located = locateAbnormalSources('CLIC-0002')
  check('点击流侧可按序列定位全部异常来源', located.length === report.abnormalClicks
    && located.every((r) => r.sequenceCode === 'CLIC-0002'))

  // 报告同步进 clickverify 模块扁平清单
  const moduleRows = listRows('clickverify')
  check('clickverify 清单从报告取得数据', moduleRows.length === 1
    && moduleRows[0]['报告编号'] === 'CVER-0001'
    && String(moduleRows[0]['异常来源定位']).includes('/pay#CLIC-0002'))
  check('清单行同时保留两侧来源',
    String(moduleRows[0]['会话记录来源']).includes('SESS-0002')
    && String(moduleRows[0]['会话事件序列来源']).includes('CLIC-0002'))

  // 任务落库为已核验
  const tasks = listVerificationTasks()
  check('任务记录为已核验并关联报告', tasks.length === 1 && tasks[0].status === '已核验' && tasks[0].reportCode === 'CVER-0001')
}

console.log('\n场景二、SESS-0002 重复提交：只保留首份，后到任务回冲突队列')
{
  fullReset()
  const first = submitVerificationTask({
    sessionCode: 'SESS-0002', sequenceCode: 'CLIC-0002', scenario: '完整提交', ...WINDOW,
  })
  const second = submitVerificationTask({
    sessionCode: 'SESS-0002', sequenceCode: 'CLIC-0002', scenario: '重复提交', ...WINDOW,
  })
  check('首份正常生成', first.kind === 'generated' && first.reportCode === 'CVER-0001')
  check('重复提交返回 conflict', second.kind === 'conflict')
  check('冲突返回原报告编号', second.conflictReportCode === 'CVER-0001')
  check('冲突说明包含内容冲突与原报告编号', second.message.includes('内容冲突') && second.message.includes('CVER-0001'))

  const reports = listIntegrityReports()
  check('仍然只有一份有效报告（不产生第二份）', reports.length === 1 && reports[0].reportCode === 'CVER-0001')

  const conflicts = listConflictTasks()
  check('重复任务进入冲突队列', conflicts.length === 1)
  check('冲突任务带原报告编号与说明',
    conflicts[0].conflictReportCode === 'CVER-0001' && Boolean(conflicts[0].conflictReason))
  check('冲突任务状态为冲突', conflicts[0].status === '冲突')

  const allTasks = listVerificationTasks()
  check('任务总数为 2（首份已核验 + 重复任务冲突）', allTasks.length === 2)
}

console.log('\n场景三、并发提交：只写入首份，重复请求回冲突队列')
{
  fullReset()
  const input = { sessionCode: 'SESS-0002', sequenceCode: 'CLIC-0002', scenario: '完整提交', ...WINDOW }
  const outcomes = [
    submitVerificationTask(input),
    submitVerificationTask(input),
    submitVerificationTask(input),
  ]
  const generated = outcomes.filter((o) => o.kind === 'generated')
  const conflicts = outcomes.filter((o) => o.kind === 'conflict')
  check('三个并发请求只生成一份报告', generated.length === 1 && generated[0].reportCode === 'CVER-0001')
  check('其余两个请求回冲突队列', conflicts.length === 2
    && conflicts.every((o) => o.conflictReportCode === 'CVER-0001'))
  check('存储里报告数仍为 1', listIntegrityReports().length === 1)
  check('冲突队列任务数为 2', listConflictTasks().length === 2)
}

console.log('\n场景四、归档后允许新报告（原报告仍可查）')
{
  fullReset()
  submitVerificationTask({ sessionCode: 'SESS-0002', sequenceCode: 'CLIC-0002', scenario: '完整提交', ...WINDOW })
  const archived = archiveReport('CVER-0001')
  check('归档成功', archived.ok)
  const again = submitVerificationTask({
    sessionCode: 'SESS-0002', sequenceCode: 'CLIC-0002', scenario: '完整提交', ...WINDOW,
  })
  check('归档释放报告位后可生成新报告 CVER-0002', again.kind === 'generated' && again.reportCode === 'CVER-0002')
  const reports = listIntegrityReports()
  check('原报告保留且为已归档', reports.some((r) => r.reportCode === 'CVER-0001' && r.status === '已归档'))
  check('有效报告只有新的一份', reports.filter((r) => r.status !== '已归档').length === 1)
}

console.log('\n场景五、相邻会话：按会话时间边界重组（跨会话拆分清单）')
{
  fullReset()
  // 给 CLIC-0002 追加一个落在相邻会话 SESS-0003 窗口内的迟到点击，制造跨会话相遇。
  const rows = listRows('clickstream')
  const target = rows.find((r) => r['序列编号'] === 'CLIC-0002')!
  const events = parseClickEvents(target)
  events.push({
    clickCode: 'CLK-207',
    sourcePage: '/profile/loyalty',
    element: '积分兑换入口',
    eventTime: '2026-09-02T09:05:00',
    batchNo: 'B0902-3',
    sequenceCode: 'CLIC-0002',
  })
  const nextRows: EntryRow[] = rows.map((r) => r['序列编号'] === 'CLIC-0002'
    ? { ...r, 点击明细: JSON.stringify(events) }
    : r)
  saveRows('clickstream', nextRows)
  allRows(true)

  const result = submitVerificationTask({
    sessionCode: 'SESS-0002',
    sequenceCode: 'CLIC-0002',
    scenario: '相邻会话',
    arbitrationMode: '会话时间边界',
    windowStart: '2026-09-02T08:00:00',
    windowEnd: '2026-09-02T09:20:00',
  })
  check('相邻会话生成报告', result.kind === 'generated')
  const arbitrations = listArbitrations()
  check('生成一条仲裁记录', arbitrations.length === 1)
  const arb = arbitrations[0]
  check('仲裁模式为会话时间边界', arb.mode === '会话时间边界')
  check('涉及两个相邻会话', arb.sessionCodes.includes('SESS-0002') && arb.sessionCodes.includes('SESS-0003'))

  const allCodes = arb.chains.flatMap((c) => c.clickCodes)
  check('每条点击只归入一个已确认会话（无重复）', new Set(allCodes).size === allCodes.length)
  const owner = new Map(arb.chains.flatMap((c) => c.clickCodes.map((code): [string, string] => [code, c.sessionCode])))
  check('迟到点击 CLK-207 拆入 SESS-0003', owner.get('CLK-207') === 'SESS-0003')
  check('跨会话拆分清单记录 CLK-207 从 SESS-0002 拆到 SESS-0003',
    arb.splitList.some((s) => s.clickCode === 'CLK-207' && s.fromSession === 'SESS-0002' && s.toSession === 'SESS-0003'))
  check('归并清单为空', arb.mergeList.length === 0)

  const report = listIntegrityReports()[0]
  check('报告关联仲裁记录编号', report.arbitrationId === arb.id)
  check('报告保留两侧来源', report.sessionSource.includes('SESS-0002') && report.eventSequenceSource.includes('CLIC-0002'))
}

console.log('\n场景六、相邻会话：按采集批次边界重组（重复采集归并清单）')
{
  fullReset()
  const result = submitVerificationTask({
    sessionCode: 'SESS-0002',
    sequenceCode: 'CLIC-0002',
    scenario: '相邻会话',
    arbitrationMode: '采集批次边界',
    windowStart: '2026-09-02T08:00:00',
    windowEnd: '2026-09-02T09:20:00',
  })
  check('批次边界仲裁也生成报告', result.kind === 'generated')
  const arb = listArbitrations()[0]
  check('仲裁模式为采集批次边界', arb.mode === '采集批次边界')
  check('归并清单含 CLK-204、CLK-205',
    arb.mergeList.map((m) => m.clickCode).sort().join() === 'CLK-204,CLK-205')
  const c204 = arb.mergeList.find((m) => m.clickCode === 'CLK-204')!
  check('CLK-204 保留 B0902-1、归并 B0902-2', c204.keptBatch === 'B0902-1' && c204.droppedBatches.includes('B0902-2'))
  check('拆分清单为空', arb.splitList.length === 0)
  const allCodes = arb.chains.flatMap((c) => c.clickCodes)
  check('归并后每条点击唯一归属', new Set(allCodes).size === allCodes.length)
}

console.log('\n场景七、来源缺失的拒绝路径')
{
  fullReset()
  const noSession = submitVerificationTask({
    sessionCode: 'SESS-9999', sequenceCode: 'CLIC-0002', scenario: '完整提交', ...WINDOW,
  })
  const noSequence = submitVerificationTask({
    sessionCode: 'SESS-0002', sequenceCode: 'CLIC-9999', scenario: '完整提交', ...WINDOW,
  })
  check('会话来源缺失不生成报告', noSession.kind === 'conflict' && noSession.message.includes('不存在'))
  check('序列来源缺失不生成报告', noSequence.kind === 'conflict' && noSequence.message.includes('不存在'))
  check('无任何报告写入', listIntegrityReports().length === 0)
}

console.log(`\n服务核对：通过 ${passCount} 项，失败 ${failCount} 项`)
if (failCount > 0) {
  process.exitCode = 1
}
