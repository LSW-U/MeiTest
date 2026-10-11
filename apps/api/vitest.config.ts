import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.ts', 'src/shared/guards/**/*.ts', 'src/shared/db/**/*.ts'],
      exclude: ['src/prisma/**', 'src/main.ts'],
      // P2 覆盖率 baseline（方案v2 D3，2026-10-11 实测 69.3/66.55/62/69.53 下浮 1pt）：
      // 70 为目标值，后续逐步上调；CI coverage step 必须显式 --exclude '**/e2e-*.test.ts' 同口径
      thresholds: {
        lines: 68,
        functions: 61,
        branches: 65,
        statements: 68,
      },
    },
  },
});
