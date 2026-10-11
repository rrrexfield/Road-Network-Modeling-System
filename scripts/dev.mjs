/**
 * dev 编排:确保派生数据存在 → 并行启动 server(tsx watch)与 web(vite)。
 * 用法:npm run dev
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const derivedFile = path.join(rootDir, 'data', 'derived', 'wuhan-roads.json');

if (!existsSync(derivedFile)) {
  console.log('[dev] 未找到派生路网数据,先运行数据预处理(npm run prepare:data)…');
  const r = spawnSync(
    process.execPath,
    ['--max-old-space-size=6144', '--import', 'tsx', 'scripts/prepare-data.ts'],
    { stdio: 'inherit', cwd: rootDir },
  );
  if (r.status !== 0) {
    console.error('[dev] 数据预处理失败,已退出。');
    process.exit(r.status ?? 1);
  }
}

const { concurrently } = await import('concurrently');

try {
  await concurrently(
    [
      {
        command: 'npx tsx watch src/index.ts',
        name: 'server',
        cwd: path.join(rootDir, 'server'),
        prefixColor: 'cyan',
      },
      {
        command: 'npx vite',
        name: 'web',
        cwd: path.join(rootDir, 'web'),
        prefixColor: 'magenta',
      },
    ],
    { prefix: 'name', killOthersOn: ['failure'] },
  ).result;
} catch {
  process.exitCode = 1;
}
