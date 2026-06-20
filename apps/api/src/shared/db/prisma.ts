/**
 * PrismaClient 单例（dev hot reload 安全）
 *
 * 决策依据：CLAUDE.md §技术栈 + Prisma 官方最佳实践
 * - Next.js / NestJS dev 模式会 hot reload，多次 new PrismaClient 会耗尽连接池
 * - 用 globalThis 缓存，全进程共享单例
 * - 生产环境不缓存到 globalThis（每个 worker 独立）
 */
import { PrismaClient } from '../../prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['warn', 'error']
        : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
