import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // dist/ 是提交物打包的暂存目录,里面是源码副本(见 scripts/package-submission.mjs),
    // 若不排除,测试会把同一批用例重复跑一遍,计数虚高且拖慢 CI。
    exclude: [...configDefaults.exclude, 'data/**', 'dist/**'],
  },
});
