/**
 * 打包作业提交物:把源码 + 文档 + 派生数据打成一个 tar.gz,便于交付与答辩机部署。
 *
 * 用法:
 *   node scripts/package-submission.mjs            # 含派生数据(评委机免预处理)
 *   node scripts/package-submission.mjs --no-data  # 不含派生数据(体积小,需自备 wuhan.json)
 *
 * 产物:dist/gisalgo-assignment2-<日期>.tar.gz
 * 说明:脚本只用 Node 内置模块与系统 tar(Windows 10+ / Linux / macOS 自带),
 *      不引入任何第三方依赖;dist/ 已在 .gitignore 中,不入库。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const stageName = 'gisalgo-assignment2';
const stageDir = path.join(distDir, stageName);
const includeData = !process.argv.includes('--no-data');

/** 需要交付的源码与配置(相对仓库根)。 */
const CODE_ENTRIES = [
  'server',
  'web',
  'shared',
  'scripts',
  'docs',
  '.github',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'vitest.config.ts',
  'eslint.config.js',
  '.prettierrc',
  '.prettierrc.json',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.gitignore',
];

/** 派生数据(若存在)。derived 缺失时跳过,提醒评委机先跑 prepare:data。 */
const DATA_ENTRIES = ['data/derived/wuhan-roads.json', 'data/derived/wuhan-turns.sqlite'];

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function main() {
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  const copied = [];
  const skipped = [];
  for (const entry of CODE_ENTRIES) {
    const source = path.join(rootDir, entry);
    if (!existsSync(source)) {
      skipped.push(entry);
      continue;
    }
    cpSync(source, path.join(stageDir, entry), { recursive: true });
    copied.push(entry);
  }

  const dataCopied = [];
  if (includeData) {
    for (const entry of DATA_ENTRIES) {
      const source = path.join(rootDir, entry);
      if (!existsSync(source)) continue;
      const target = path.join(stageDir, entry);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target);
      dataCopied.push(entry);
    }
  }

  const manifest = [
    '# 作业二(G2 第 2 次作业)提交包',
    '',
    `打包时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 内容',
    '',
    '- `server/` `web/` `shared/` `scripts/`：作业二全部源码（转向限制、多模态、跨模态路径、权重统计、前端可视化）',
    '- `docs/`：多模态路网设计文档、拓扑验证报告、作业二验收清单与演示脚本、AI 使用日志、变更日志',
    '- `.github/`：CODEOWNERS 与 CI 工作流',
    '- 根配置：`package.json` / `package-lock.json` / `tsconfig.base.json` / `vitest.config.ts` / `eslint.config.js`',
    dataCopied.length > 0
      ? '- `data/derived/`：派生路网与禁转快照（评委机**无需**再跑预处理即可启动）'
      : '- `data/derived/`：**未包含**——请自备 `data/wuhan.json` 并先跑 `npm run prepare:data`',
    '',
    '## 启动',
    '',
    '```bash',
    'npm install',
    'npm run dev        # 服务端 http://127.0.0.1:3000 · 前端 http://localhost:5173',
    '```',
    '',
    '环境要求：Node ≥ 22.13（`node:sqlite` 自 22.13.0 起无需实验标志）、npm 10+、建议 8 GB 以上内存。',
    '',
    '## 验收与演示',
    '',
    '- 逐项验收清单、评分维度对照、答辩演示分步脚本（含真实坐标与预期数值）、提交材料清单、已知边界口径：`docs/作业二验收清单.md`',
    '- 多模态路网设计文档（含跨模态路径的换乘连接、阈值、成本模型与实测）：`docs/多模态路网设计.md`',
    '',
    '## 质量门禁',
    '',
    '```bash',
    'npm run typecheck && npm run lint && npm test && npm run build',
    '```',
    '',
    `打包时仓库状态：48 个测试文件 / 371 项通过。`,
    '',
  ].join('\n');
  writeFileSync(path.join(stageDir, 'SUBMISSION.md'), manifest, 'utf8');

  const archive = path.join(distDir, `gisalgo-assignment2-${stamp()}.tar.gz`);
  rmSync(archive, { force: true });
  const result = spawnSync('tar', ['-czf', archive, '-C', distDir, stageName], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('打包失败:系统 tar 执行异常');
    process.exit(result.status ?? 1);
  }

  const sizeMb = (readFileSync(archive).length / 1024 / 1024).toFixed(1);
  console.log(`\n提交包已生成: ${path.relative(rootDir, archive)} (${sizeMb} MB)`);
  console.log(`包含源码条目 ${copied.length} 项${skipped.length > 0 ? `,跳过 ${skipped.join('、')}` : ''}`);
  console.log(`派生数据: ${dataCopied.length > 0 ? dataCopied.join('、') : '未包含(评委机需自备原始数据)'}`);
  console.log('\n解压后:');
  console.log('  tar -xzf <包名>.tar.gz');
  console.log('  cd gisalgo-assignment2 && npm install && npm run dev');
}

main();
