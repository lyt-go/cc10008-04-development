<template>
  <section class="page" data-module="clickverify">
    <header class="page-head">
      <div>
        <h2>会话点击链完整性核验</h2>
        <p class="page-desc">
          读取待处理的会话记录与点击序列，核验生成会话点击链完整性数据报告；每条结论可回来源页面核验，
          同一会话只保留一份有效报告，重复任务进冲突队列。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 提交核验任务：完整提交 / 重复提交 / 相邻会话三种输入 -->
    <div class="panel">
      <h3 class="panel-title">提交核验任务</h3>
      <form class="filter-bar" @submit.prevent="submit">
        <label class="filter-item">
          <span>核验场景</span>
          <select v-model="form.scenario">
            <option v-for="item in scenarios" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>会话编号</span>
          <input v-model="form.sessionCode" placeholder="如 SESS-0002" />
        </label>
        <label class="filter-item">
          <span>点击序列编号</span>
          <input v-model="form.sequenceCode" placeholder="如 CLIC-0002" />
        </label>
        <label class="filter-item">
          <span>核验窗口起</span>
          <input v-model="form.windowStart" placeholder="2026-09-02T08:00:00" />
        </label>
        <label class="filter-item">
          <span>核验窗口止</span>
          <input v-model="form.windowEnd" placeholder="2026-09-02T08:30:00" />
        </label>
        <label v-if="form.scenario === '相邻会话'" class="filter-item">
          <span>仲裁做法</span>
          <select v-model="form.arbitrationMode">
            <option value="会话时间边界">按会话时间边界重组（留跨会话拆分清单）</option>
            <option value="采集批次边界">按采集批次边界重组（留重复采集归并清单）</option>
          </select>
        </label>
        <button class="btn primary" type="submit">提交核验</button>
        <button class="btn ghost" type="button" @click="fillScenario">填入该场景参数</button>
      </form>
      <p v-if="message" :class="['form-msg', messageOk ? 'ok-text' : 'error-text']">{{ message }}</p>
      <div class="scenario-hint">
        <p v-for="item in scenarios" :key="item.value" class="hint-line">
          <strong>{{ item.label }}</strong>：{{ item.hint }}
        </p>
      </div>
    </div>

    <!-- 报告清单：点击流清单从这里取得完整性报告 -->
    <div class="panel">
      <h3 class="panel-title">会话点击链完整性数据报告（每会话一份有效报告）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>报告编号</th><th>会话编号</th><th>序列编号</th><th>核验窗口</th>
            <th>结论</th><th>异常数</th><th>来源页面</th><th>任务编号</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="report in reports" :key="report.reportCode">
            <td>{{ report.reportCode }}</td>
            <td>{{ report.sessionCode }}</td>
            <td>{{ report.sequenceCode }}</td>
            <td class="nowrap">{{ report.windowStart }}<br />{{ report.windowEnd }}</td>
            <td>
              <span :class="report.chainIntact ? 'tag ok' : 'tag bad'">
                {{ report.chainIntact ? '点击链完整' : '点击链不完整' }}
              </span>
            </td>
            <td>{{ report.abnormalClicks }} / {{ report.totalClicks }}</td>
            <td class="nowrap">{{ report.sourcePageRefs.join('、') }}</td>
            <td>{{ report.taskCode }}</td>
            <td>{{ report.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openReport(report.reportCode)">核验明细</button>
              <button
                v-if="report.status !== '已归档'"
                class="link"
                type="button"
                @click="archive(report.reportCode)"
              >归档报告</button>
            </td>
          </tr>
          <tr v-if="!reports.length">
            <td colspan="10" class="empty-state">尚无报告，先在上方提交核验任务</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 冲突队列 -->
    <div class="panel">
      <h3 class="panel-title">冲突队列（重复任务回到这里，附原报告编号与冲突说明）</h3>
      <table class="data-table">
        <thead>
          <tr><th>任务编号</th><th>会话编号</th><th>序列编号</th><th>场景</th><th>原报告编号</th><th>冲突说明</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="task in conflictTasks" :key="task.taskCode" class="conflict-row">
            <td>{{ task.taskCode }}</td>
            <td>{{ task.sessionCode }}</td>
            <td>{{ task.sequenceCode }}</td>
            <td>{{ task.scenario }}</td>
            <td>
              <button class="link" type="button" @click="openReport(task.conflictReportCode!)">
                {{ task.conflictReportCode }}
              </button>
            </td>
            <td class="reason-cell">{{ task.conflictReason }}</td>
            <td><span class="tag warn">{{ task.status }}</span></td>
          </tr>
          <tr v-if="!conflictTasks.length">
            <td colspan="7" class="empty-state">冲突队列为空</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 核验明细抽屉：逐点击回来源页面核验 + 异常来源定位 -->
    <div v-if="activeReport" class="drawer-mask" @click.self="activeReport = null">
      <div class="drawer">
        <header class="drawer-head">
          <h3>{{ activeReport.reportCode }} 核验明细</h3>
          <button class="btn ghost" type="button" @click="activeReport = null">关闭</button>
        </header>
        <div class="drawer-body">
          <ul class="source-list">
            <li>会话记录来源：{{ activeReport.sessionSource }}</li>
            <li>会话事件序列来源：{{ activeReport.eventSequenceSource }}</li>
            <li>可回来源页面：{{ activeReport.sourcePageRefs.join('、') }}</li>
            <li v-if="activeReport.arbitrationId">
              仲裁记录：#{{ activeReport.arbitrationId }}
              <button class="link" type="button" @click="openArbitration(activeReport.arbitrationId!)">查看仲裁清单</button>
            </li>
          </ul>
          <table class="data-table">
            <thead>
              <tr><th>下标</th><th>点击编号</th><th>来源页面</th><th>元素</th><th>时间</th><th>结论</th><th>异常来源定位 / 说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in activeReport.checkResults" :key="index" :class="{ 'row-abnormal': item.result !== '通过' }">
                <td>{{ index }}</td>
                <td>{{ item.clickCode }}</td>
                <td>{{ item.sourcePage }}</td>
                <td>{{ item.element }}</td>
                <td class="nowrap">{{ item.eventTime }}</td>
                <td><span :class="resultTag(item.result)">{{ item.result }}</span></td>
                <td class="reason-cell">
                  <template v-if="item.sourceEntry">
                    <button class="link" type="button" @click="goClickstream(item.sequenceCode)">
                      {{ item.sourceEntry.page }}#{{ item.sourceEntry.sequenceCode }}[{{ item.sourceEntry.clickIndex }}]
                    </button>
                  </template>
                  <template v-else>—</template>
                  <div class="reason-text">{{ item.reason }}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 仲裁清单抽屉 -->
    <div v-if="activeArbitration" class="drawer-mask" @click.self="activeArbitration = null">
      <div class="drawer wide">
        <header class="drawer-head">
          <h3>版本冲突仲裁 #{{ activeArbitration.id }}（{{ activeArbitration.mode }}）</h3>
          <button class="btn ghost" type="button" @click="activeArbitration = null">关闭</button>
        </header>
        <div class="drawer-body">
          <p class="form-msg">
            核验窗口：{{ activeArbitration.windowStart }} ~ {{ activeArbitration.windowEnd }}；
            涉及会话：{{ activeArbitration.sessionCodes.join('、') }}。每条点击只归入一个已确认会话，不能被打破。
          </p>
          <h4 class="sub-title">已确认会话点击链（唯一归属）</h4>
          <table class="data-table">
            <thead><tr><th>已确认会话</th><th>归入点击编号</th><th>点击数</th></tr></thead>
            <tbody>
              <tr v-for="chain in activeArbitration.chains" :key="chain.sessionCode">
                <td>{{ chain.sessionCode }}</td>
                <td>{{ chain.clickCodes.join('、') }}</td>
                <td>{{ chain.clickCodes.length }}</td>
              </tr>
            </tbody>
          </table>

          <template v-if="activeArbitration.mode === '会话时间边界'">
            <h4 class="sub-title">跨会话拆分清单</h4>
            <table class="data-table">
              <thead><tr><th>点击编号</th><th>时间</th><th>原会话</th><th>拆入会话</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(item, i) in activeArbitration.splitList" :key="i">
                  <td>{{ item.clickCode }}</td><td class="nowrap">{{ item.eventTime }}</td>
                  <td>{{ item.fromSession }}</td><td>{{ item.toSession }}</td><td class="reason-cell">{{ item.reason }}</td>
                </tr>
                <tr v-if="!activeArbitration.splitList.length"><td colspan="5" class="empty-state">无跨会话拆分</td></tr>
              </tbody>
            </table>
          </template>

          <template v-else>
            <h4 class="sub-title">重复采集归并清单</h4>
            <table class="data-table">
              <thead><tr><th>点击编号</th><th>保留批次</th><th>归并批次</th><th>归入会话</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(item, i) in activeArbitration.mergeList" :key="i">
                  <td>{{ item.clickCode }}</td><td>{{ item.keptBatch }}</td>
                  <td>{{ item.droppedBatches.join('、') }}</td><td>{{ item.mergedIntoSession }}</td>
                  <td class="reason-cell">{{ item.reason }}</td>
                </tr>
                <tr v-if="!activeArbitration.mergeList.length"><td colspan="5" class="empty-state">无重复采集归并</td></tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>报告与仲裁清单保存在本机浏览器；点击流页通过同一数据源读取本页报告并保留各自来源。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  archiveReport,
  listArbitrations,
  listConflictTasks,
  listIntegrityReports,
  listVerificationTasks,
  submitVerificationTask,
} from '@/api/clickverify-service'
import { resetClickverifyStorage } from '@/data/clickverify-store'
import { resetRows } from '@/data/local-store'
import type { ArbitrationRecord, IntegrityReport } from '@/data/clickverify-types'

const router = useRouter()
const route = useRoute()

const scenarios = [
  {
    value: '完整提交',
    label: '完整提交',
    hint: 'SESS-0002 + CLIC-0002 在会话窗口内的完整点击链，含重复采集与来源页面入口缺失两类异常。',
  },
  {
    value: '重复提交',
    label: '重复提交',
    hint: '同一会话再次提交核验，只保留首份报告，后到任务收到原报告编号与冲突说明并进冲突队列。',
  },
  {
    value: '相邻会话',
    label: '相邻会话',
    hint: 'SESS-0002 与相邻会话在同一核验窗口相遇，按会话时间边界或采集批次边界仲裁，每条点击唯一归属。',
  },
] as const

const form = reactive({
  scenario: '完整提交' as string,
  sessionCode: 'SESS-0002',
  sequenceCode: 'CLIC-0002',
  windowStart: '2026-09-02T08:00:00',
  windowEnd: '2026-09-02T08:30:00',
  arbitrationMode: '会话时间边界' as '会话时间边界' | '采集批次边界',
})

const reports = ref<IntegrityReport[]>([])
const conflictTasks = ref<ReturnType<typeof listConflictTasks>>([])
const arbitrations = ref<ArbitrationRecord[]>([])
const activeReport = ref<IntegrityReport | null>(null)
const activeArbitration = ref<ArbitrationRecord | null>(null)
const message = ref('')
const messageOk = ref(false)

const stats = computed(() => [
  { label: '完整性报告总数', value: reports.value.length },
  { label: '核验异常报告', value: reports.value.filter((r) => !r.chainIntact).length },
  { label: '冲突队列任务', value: conflictTasks.value.length },
  { label: '仲裁记录', value: arbitrations.value.length },
])

function fillScenario() {
  if (form.scenario === '相邻会话') {
    form.sessionCode = 'SESS-0002'
    form.sequenceCode = 'CLIC-0002'
    form.windowStart = '2026-09-02T08:00:00'
    form.windowEnd = '2026-09-02T09:20:00'
  } else {
    form.sessionCode = 'SESS-0002'
    form.sequenceCode = 'CLIC-0002'
    form.windowStart = '2026-09-02T08:00:00'
    form.windowEnd = '2026-09-02T08:30:00'
  }
}

function submit() {
  message.value = ''
  const result = submitVerificationTask({ ...form })
  messageOk.value = result.kind === 'generated'
  message.value = result.message
  reload()
}

function openReport(code?: string) {
  if (!code) {
    return
  }
  activeReport.value = reports.value.find((r) => r.reportCode === code) ?? null
}

function openArbitration(id: number) {
  activeArbitration.value = arbitrations.value.find((r) => r.id === id) ?? null
}

function archive(code: string) {
  const result = archiveReport(code)
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function goClickstream(sequenceCode: string) {
  router.push({ path: '/clickstream', query: { sequence: sequenceCode, from: 'clickverify' } })
}

function resetDemo() {
  resetClickverifyStorage()
  resetRows('clickverify')
  message.value = '核验演示数据已重置，可重新跑三种场景'
  messageOk.value = true
  reload()
}

function resultTag(result: string): string {
  if (result === '通过') {
    return 'tag ok'
  }
  if (result === '重复采集') {
    return 'tag warn'
  }
  return 'tag bad'
}

function reload() {
  reports.value = listIntegrityReports()
  conflictTasks.value = listConflictTasks()
  arbitrations.value = listArbitrations()
  // 触发任务统计的读取，保证任务列表已落库。
  listVerificationTasks()
}

onMounted(() => {
  // 跨模块入口：会话重放/点击流带着 session 或 report 编号跳进来时自动定位。
  const session = String(route.query.session ?? '')
  const report = String(route.query.report ?? '')
  if (session) {
    form.sessionCode = session
  }
  reload()
  if (report) {
    openReport(report)
  }
})
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.panel-title { margin: 0 0 10px; font-size: 15px; }
.sub-title { margin: 14px 0 6px; font-size: 13px; color: #334155; }
.nowrap { white-space: nowrap; }
.reason-cell { max-width: 320px; }
.reason-text { color: var(--muted); font-size: 12px; margin-top: 2px; }
.tag { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.tag.ok { background: #e6f7ec; color: #067647; }
.tag.bad { background: #fdecec; color: #b42318; }
.tag.warn { background: #fff4e0; color: #b54708; }
.form-msg { font-size: 13px; margin: 8px 0 0; }
.ok-text { color: #067647; }
.scenario-hint { margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px; }
.hint-line { margin: 4px 0; font-size: 12px; color: var(--muted); }
.conflict-row { background: #fffaf0; }
.row-abnormal { background: #fef6f6; }
.drawer-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; justify-content: flex-end; z-index: 50;
}
.drawer {
  width: 760px; max-width: 92vw; height: 100%; background: #fff;
  display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,0.15);
}
.drawer.wide { width: 920px; }
.drawer-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
}
.drawer-body { padding: 14px 18px; overflow: auto; }
.source-list { margin: 0 0 12px; padding-left: 18px; font-size: 13px; color: #334155; }
.source-list li { margin-bottom: 4px; }
select {
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
  font-size: 13px; background: #fff; min-width: 160px;
}
</style>
