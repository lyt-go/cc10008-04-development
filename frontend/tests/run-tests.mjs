/**
 * 用 esbuild 把 tests/*.test.ts 打成可在 Node 直接跑的 ESM，再顺序执行。
 * 与前端构建隔离：测试不进 src，产物写到 .test-build（已在 .gitignore 之外单独清理）。
 */
import { build } from 'esbuild'
import { rmSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, '.test-build')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const entryPoints = readdirSync(here)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => join(here, name))

await build({
  entryPoints,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: outDir,
  alias: { '@': join(root, 'src') },
  logLevel: 'warning',
})

let failed = 0
for (const name of entryPoints.map((p) => p.split('/').pop()?.replace('.ts', '.js'))) {
  console.log(`\n=== ${name} ===`)
  try {
    await import(pathToFileURL(join(outDir, name)).href)
  } catch (error) {
    failed += 1
    console.error(error)
  }
}

if (process.exitCode === 1 || failed > 0) {
  console.error('\n存在失败用例')
  process.exit(1)
}
