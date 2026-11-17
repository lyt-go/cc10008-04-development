# 行为特征分析与事件溯源平台

面向用户行为打点采集、事件参数规范、会话重放、热力图分析、特征工程提取与行为标签体系管理的本地化数据分析应用平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 事件规范 | `eventspec` | 事件定义 | 事件编号、事件名称、事件类别 |
| 会话重放 | `session` | 会话记录 | 会话编号、用户标识、开始时间 |
| 热力分析 | `heatmap` | 热力方案 | 方案编号、目标页面、点击热力图 |
| 特征工程 | `feature` | 特征模板 | 模板编号、特征名称、特征类型 |
| 行动标签 | `action` | 标签规则 | 规则编号、标签名称、标签类别 |
| 路径分析 | `pathmap` | 路径模型 | 模型编号、起始页面、终止页面 |
| 事件溯源 | `eventtrace` | 事件链路 | 链路编号、事件链序列、链长度 |
| 时段分析 | `timewindow` | 时段配置 | 配置编号、时段名称、起始时分 |
| 设备分析 | `device` | 设备画像 | 画像编号、设备类型、操作系统 |
| 异常检测 | `anomaly` | 检测器 | 检测器编号、监控事件、异常模式 |
| 群组对比 | `cohortcmp` | 对比任务 | 任务编号、群组A、群组B |
| 漏斗诊断 | `funnel` | 诊断报告 | 报告编号、漏斗名称、步骤定义 |
| 浏览深度 | `scrollmap` | 深度分析 | 分析编号、页面名称、首屏占比 |
| 表单分析 | `formfield` | 表单诊断 | 诊断编号、表单名称、总字段数 |
| 点击流 | `clickstream` | 点击序列 | 序列编号、用户标识、起始时间 |
| 点击链核验 | `clickverify` | 完整性核验报告 | 报告编号、会话编号、异常来源定位 |
| 回访分析 | `retention` | 回访模式 | 模式编号、用户分群、首次访问窗口 |
| 数据视图 | `dataview` | 分析视图 | 视图编号、视图名称、数据源组合 |
| 参数字典 | `paramdef` | 参数定义 | 参数编号、参数名称、参数类型 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `behavior-event-trace-hub:entries` 这一项，或调用 `resetModule(模块)`。

## 会话点击链完整性核验

「点击链核验」(`clickverify`) 读取待处理的会话记录（会话重放）与点击序列（点击流），核验生成
**会话点击链完整性数据报告**，相关实现集中在：

```text
src/data/clickverify-types.ts      核验领域结构化类型（报告/任务/仲裁/逐点击结论）
src/data/clickchain.ts             纯领域逻辑：逐点击核验 + 两种仲裁做法（无 DOM、无存储）
src/data/clickverify-sources.ts    跨模块数据流：两个业务面共用的会话事件序列取数口 + 来源页面入口表
src/data/clickverify-store.ts      报告/任务/仲裁记录的 localStorage 持久化
src/api/clickverify-service.ts     提交核验、单份报告约束、冲突队列、归档
src/views/clickverify/index.vue    核验页面（提交、报告、冲突队列、核验明细、仲裁清单抽屉）
```

核验与并发约定：

- 每条点击都能**回来源页面**核验现有入口能否形成稳定业务结果，结论分为通过 / 入口缺失 / 断链 /
  重复采集；异常项带 `来源页面#点击序列[下标]`，点击流侧据此定位异常来源。
- **同一会话只保留一份有效报告**：两个核验任务同时确认同一会话时，后到任务收到内容冲突说明和
  原报告编号并进入冲突队列；并发提交只写入首份报告。
- 点击流清单从新生成的报告取得完整性结论，同时保留会话记录来源和会话事件序列来源；会话重放与
  点击流在会话事件序列入口共用 `clickverify-sources.ts` 这一份跨模块数据流。
- 重复采集序列与相邻会话在同一核验窗口相遇时有两种仲裁做法：按**会话时间边界**重组（留跨会话
  拆分清单）、按**采集批次边界**重组（留重复采集归并清单）。无论哪种，每条点击只归入一个已确认
  会话，不能被打破（`assertSingleAssignment` 校验该不变量）。
- `SESS-0002` 预置了完整提交（含重复批次 CLK-204/205、来源页面入口缺失 CLK-206）、重复提交、
  相邻会话三种输入，可在页面直接复现。

## 测试

领域逻辑与端到端流程的核对脚本在 `frontend/tests/`，用 esbuild 打包后在 Node 下运行（含
localStorage 垫片，不依赖浏览器）：

```bash
cd frontend
npm test
```

覆盖：逐点击核验规则、两种仲裁清单、单份报告与冲突队列、并发首写、相邻会话拆分/归并不变量、
老版本 localStorage 字段迁移，共 80+ 项断言。

领域：数据工程
子方向：数据分析与数据应用
