/**
 * 补充核对：
 * 1. 老版本 localStorage（没有结构化字段、没有 clickverify 键）迁移后能补齐核验字段。
 * 2. 完整提交 -> 重复提交的用户视角返回内容（原报告编号 + 冲突说明）。
 */
import { shim } from './local-storage-shim'

// 先写入一份「老格式」存储：会话/点击流行缺少新字段，且没有 clickverify 模块。
const legacy = {
  session: [
    { id: 2, status: '已采集', pending: true, abnormal: true, 会话编号: 'SESS-0002', 用户标识: 'U-1002' },
  ],
  clickstream: [
    { id: 2, status: '已采集', pending: true, abnormal: true, 序列编号: 'CLIC-0002', 用户标识: 'U-1002' },
  ],
}
shim.setItem('behavior-event-trace-hub:entries', JSON.stringify(legacy))

const { allRows, listRows } = await import('@/data/local-store')
allRows(true)

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`) } else { fail += 1; console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`) }
}

console.log('一、老数据迁移')
{
  const sess = listRows('session').find((r) => r['会话编号'] === 'SESS-0002')!
  const clic = listRows('clickstream').find((r) => r['序列编号'] === 'CLIC-0002')!
  check('会话行补齐会话边界字段', typeof sess['会话边界'] === 'string' && sess['会话边界'].includes('SESS-0002'))
  check('点击流行补齐点击明细字段', typeof clic['点击明细'] === 'string' && clic['点击明细'].includes('CLK-201'))
  check('用户已有状态保持不变', sess.status === '已采集' && clic.status === '已采集')
  check('补齐 clickverify 模块空清单', Array.isArray(listRows('clickverify')) && listRows('clickverify').length === 0)
}

console.log('二、迁移后可直接核验（完整 -> 重复）')
{
  const { submitVerificationTask } = await import('@/api/clickverify-service')
  const first = submitVerificationTask({
    sessionCode: 'SESS-0002', sequenceCode: 'CLIC-0002', scenario: '完整提交',
    windowStart: '2026-09-02T08:00:00', windowEnd: '2026-09-02T08:30:00',
  })
  const second = submitVerificationTask({
    sessionCode: 'SESS-0002', sequenceCode: 'CLIC-0002', scenario: '重复提交',
    windowStart: '2026-09-02T08:00:00', windowEnd: '2026-09-02T08:30:00',
  })
  check('首份生成 CVER-0001', first.kind === 'generated' && first.reportCode === 'CVER-0001')
  check('重复任务收到 conflict 与原报告编号', second.kind === 'conflict' && second.conflictReportCode === 'CVER-0001')
  check('冲突说明可读且含原报告编号', second.message.includes('内容冲突') && second.message.includes('CVER-0001'))
}

console.log(`\n迁移核对：通过 ${pass} 项，失败 ${fail} 项`)
if (fail > 0) process.exitCode = 1
