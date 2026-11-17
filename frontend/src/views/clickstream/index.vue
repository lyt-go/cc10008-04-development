<template>
  <section class="page" data-module="clickstream">
    <header class="page-head">
      <div>
        <h2>点击流管理</h2>
        <p class="page-desc">
          记录和分析用户点击流序列，区分有效点击和无效点击行为。完整性报告由「点击链核验」生成，
          本页从新生成的报告取数，同时保留会话记录来源和会话事件序列来源。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记点击序列</button>
        <button class="btn" type="button" @click="exportRows">导出点击流清单</button>
        <RouterLink class="btn" to="/clickverify">前往点击链核验</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-focus': row['序列编号'] === focusSequence }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="locate(row)">定位异常来源</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无点击流数据，可先登记点击序列</td>
        </tr>
      </tbody>
    </table>

    <!-- 跨模块数据流：会话事件序列入口，两个业务面共用同一份读取结果 -->
    <div class="panel">
      <h3 class="panel-title">会话事件序列入口（与会话重放共用跨模块数据流）</h3>
      <table class="data-table">
        <thead>
          <tr><th>点击序列</th><th>关联会话</th><th>会话事件序列来源</th><th>会话记录来源</th><th>事件数</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in sharedStream" :key="item.sequenceCode">
            <td>{{ item.sequenceCode }}</td>
            <td>
              <RouterLink class="link" :to="`/session?session=${item.sessionCode}`">{{ item.sessionCode }}</RouterLink>
            </td>
            <td class="source-cell">{{ item.eventSequenceSource }}</td>
            <td class="source-cell">{{ item.sessionSource }}</td>
            <td>{{ item.eventCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 完整性报告取自点击链核验模块 -->
    <div class="panel">
      <h3 class="panel-title">会话点击链完整性报告（取自点击链核验，保留两侧来源）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>报告编号</th><th>会话编号</th><th>序列编号</th><th>结论</th>
            <th>异常来源定位</th><th>会话记录来源</th><th>会话事件序列来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="report in reports" :key="report.reportCode" :class="{ 'row-focus': report.sequenceCode === focusSequence }">
            <td>
              <RouterLink class="link" :to="`/clickverify?report=${report.reportCode}`">{{ report.reportCode }}</RouterLink>
            </td>
            <td>{{ report.sessionCode }}</td>
            <td>{{ report.sequenceCode }}</td>
            <td>
              <span :class="report.chainIntact ? 'tag ok' : 'tag bad'">
                {{ report.chainIntact ? '点击链完整' : `异常${report.abnormalClicks}处` }}
              </span>
            </td>
            <td class="source-cell">
              <template v-for="(item, i) in abnormalOf(report)" :key="i">
                <button class="link locate-link" type="button" @click="focusEntry(item)">
                  {{ item.sourceEntry?.page }}#{{ item.sourceEntry?.sequenceCode }}[{{ item.sourceEntry?.clickIndex }}]
                </button>
                <span class="locate-result">（{{ item.result }}）</span>
                <br v-if="i < abnormalOf(report).length - 1" />
              </template>
              <span v-if="!abnormalOf(report).length">无异常</span>
            </td>
            <td class="source-cell">{{ report.sessionSource }}</td>
            <td class="source-cell">{{ report.eventSequenceSource }}</td>
          </tr>
          <tr v-if="!reports.length">
            <td colspan="7" class="empty-state">暂无完整性报告，请到「点击链核验」提交核验任务</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条点击流记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listIntegrityReports } from '@/api/clickverify-service'
import {
  describeEventSequenceSource,
  describeSessionSource,
  findClickstreamRow,
  readClickEvents,
} from '@/data/clickverify-sources'
import type { EntryRow } from '@/data/types'
import type { IntegrityReport } from '@/data/clickverify-types'

const route = useRoute()
const meta = moduleMeta('clickstream')
const columns = ["序列编号", "用户标识", "起始时间", "页面序列", "点击元素序列", "总点击数", "有效点击数", "无效点击数"]
const actions = ["确认采集", "提交分析", "归档序列"]
const statuses = ["草稿", "已采集", "已分析", "已归档"]
const stats = computed(() => [
  { label: "点击序列总数", value: rows.value.length },
  { label: "今日点击量", value: rows.value.reduce((sum, row) => sum + Number(row['总点击数'] || 0), 0) },
  { label: "已分析序列", value: rows.value.filter((row) => row.status === '已分析').length },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reports = ref<IntegrityReport[]>([])
const focusSequence = ref<string>(String(route.query.sequence ?? ''))

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 跨模块数据流：同一套来源读取，两个业务面在会话事件序列入口共用。
const sharedStream = computed(() =>
  rows.value.map((row) => {
    const sequenceCode = String(row['序列编号'])
    const sessionCode = String(row['关联会话'] ?? '')
    return {
      sequenceCode,
      sessionCode,
      eventCount: readClickEvents(sequenceCode).length,
      eventSequenceSource: describeEventSequenceSource(sequenceCode),
      sessionSource: sessionCode ? describeSessionSource(sessionCode) : '未关联会话',
    }
  }),
)

function abnormalOf(report: IntegrityReport) {
  return report.checkResults.filter((item) => item.result !== '通过' && item.sourceEntry)
}

function focusEntry(item: IntegrityReport['checkResults'][number]) {
  if (item.sourceEntry) {
    focusSequence.value = item.sourceEntry.sequenceCode
    errorMessage.value = `异常来源定位：${item.sourceEntry.page}#${item.sourceEntry.sequenceCode}[${item.sourceEntry.clickIndex}]，${item.reason}`
  }
}

function locate(row: EntryRow) {
  const sequenceCode = String(row['序列编号'])
  const hit = reports.value.find((report) => report.sequenceCode === sequenceCode)
  if (!hit) {
    errorMessage.value = `序列 ${sequenceCode} 还没有完整性报告，请到点击链核验提交任务`
    return
  }
  const first = abnormalOf(hit)[0]
  if (!first) {
    errorMessage.value = `序列 ${sequenceCode} 的报告 ${hit.reportCode} 未发现异常`
    return
  }
  focusEntry(first)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '点击序列登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reports.value = listIntegrityReports()
    if (focusSequence.value && !findClickstreamRow(focusSequence.value)) {
      focusSequence.value = ''
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '点击流列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-top: 14px;
}
.panel-title { margin: 0 0 10px; font-size: 15px; }
.tag { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.tag.ok { background: #e6f7ec; color: #067647; }
.tag.bad { background: #fdecec; color: #b42318; }
.source-cell { max-width: 300px; font-size: 12px; color: #334155; }
.locate-link { margin-right: 2px; }
.locate-result { font-size: 12px; color: var(--muted); }
.row-focus { background: #fff7ed !important; }
</style>
