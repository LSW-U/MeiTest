/**
 * RefundModule 真 DI 装配冒烟（批1 审查 P1-1 修复验证 20261122）
 *
 * 审查 P1-1：RefundModule 此前 imports 缺 NotificationModule——D13 通知门面
 * NotificationEventService 在生产 DI 容器中因 @Optional 静默 undefined，
 * cancelOrderInTx 的 orderCancelled 通知恒不发。单测直 new 绕过容器掩盖了断链
 * （memory：Nest DI 显式 @Inject 块同款盲区）。
 *
 * 本文件用 @nestjs/testing 起**真 DI 容器**解析 RefundModule，断言：
 *   1. RefundService.notificationEvents 非 undefined（装配通路闭合）
 *   2. 通知门面是 NotificationEventService 实例（exports useExisting 透传正确）
 *
 * 外部依赖（db/redis/BullMQ/storage）全部 mock——只验证 DI 装配，不测业务逻辑
 * （业务逻辑在 refund.service.test.ts / order.service.test.ts）。自包含进 `pnpm test` 门禁。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    notification: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    deviceToken: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

// 真 module 链会评估 shared/db、shared/cache import——mock 断开真实连接
vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  rollbackSalesCountForRefundItems: vi.fn(),
  rollbackSalesCountForFullOrder: vi.fn(),
  releaseStock: vi.fn(),
}));
vi.mock('../src/shared/cache', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), eval: vi.fn() },
  createTicket: vi.fn(),
  consumeTicket: vi.fn(),
}));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/shared/storage/storage.service', () => ({
  StorageService: class {
    isOwnUrl = vi.fn().mockReturnValue(true);
    uploadFile = vi.fn();
    deleteFile = vi.fn();
  },
}));
// BullMQ 队列注册（NotificationModule processor 用）——mock 掉真实 redis 连接
vi.mock('../src/shared/queue/queue', () => ({
  getQueue: vi.fn().mockReturnValue({ add: vi.fn(), process: vi.fn() }),
  createQueue: vi.fn().mockReturnValue({ add: vi.fn(), process: vi.fn() }),
}));
// NotifyFactory 外部推送通道（email/sms/push/whatsapp）不测，mock
vi.mock('../src/infrastructure', () => ({
  NotifyFactory: class {
    notify = vi.fn().mockResolvedValue(undefined);
  },
  EmailNotifyStrategy: class {},
  SmsNotifyStrategy: class {},
  PushNotifyStrategy: class {},
  WhatsAppNotifyStrategy: class {},
}));

// OrderModule 内 OrderTimeoutProcessor（BullMQ WorkerHost）与 OrderService 存在
// 环状 import，vitest 模块评估顺序下构造器元数据丢失致 DI 报错——本文件只验证
// RefundModule 装配，超时 processor 用哑类替身（业务在 order.service.test 覆盖）
vi.mock('../src/modules/order/order-timeout.processor', () => ({
  OrderTimeoutProcessor: class {},
  ORDER_TIMEOUT_MS: 15 * 60 * 1000,
}));
// SuggestionTimeoutProcessor 是真 WorkerHost，实例化需 BullMQ 连接——同上替身
vi.mock('../src/modules/order/suggestion-timeout.processor', () => ({
  SuggestionTimeoutProcessor: class {},
}));
// Scheduler 的 OnModuleInit 会拉真实队列——替身
vi.mock('../src/modules/order/suggestion-timeout.scheduler', () => ({
  SuggestionTimeoutScheduler: class {},
}));
// NotificationPushProcessor 是真 WorkerHost（BullExplorer 实例化 Worker 需 redis 连接）
// ——本文件只验 DI 装配通路，processor 用哑类替身（业务在 notification 侧测试覆盖）
vi.mock('../src/modules/notification/notification-push.processor', () => ({
  NotificationPushProcessor: class {},
}));
// 其余 WorkerHost processor（经 forwardRef 模块链可达）：同理替身，只保 DI 装配验证
vi.mock('../src/modules/promotion/coupon-expire.processor', () => ({
  CouponExpireProcessor: class {},
}));
vi.mock('../src/modules/catalog/collaborative.processor', () => ({
  CollaborativeProcessor: class {},
}));
vi.mock('../src/modules/engagement/engagement.processor', () => ({
  EngagementProcessor: class {},
}));
vi.mock('../src/modules/ticket/ticket-timeout.processor', () => ({
  TicketTimeoutProcessor: class {},
}));
vi.mock('../src/modules/settle/settle.processor', () => ({
  SettleProcessor: class {},
}));
vi.mock('../src/modules/upload/orphan-cleanup.processor', () => ({
  OrphanCleanupProcessor: class {},
}));

// @nestjs/bullmq 整体替身：registerQueue 无 forRoot 时会建无密码默认连接（NOAUTH），
// getQueueToken/InjectQueue 用确定性字符串 token 保 useExisting 透传一致；
// WorkerHost 基类给空类（真 processor 已全部用哑类替身，见下）
// 批3 兼容（工作区改动，随批3/后续 commit 收口）：批3 suggestion-refund-retry.processor
// 用 @Processor 装饰器，替身需补空操作导出否则 DI 冒烟在装配即抛错
vi.mock('@nestjs/bullmq', () => {
  const queueToken = (name: string) => `BullQueue_${name}`;
  const makeQueueProvider = (name: string) => ({
    provide: queueToken(name),
    useValue: { add: vi.fn(), process: vi.fn() },
  });
  return {
    BullModule: {
      forRoot: () => ({ global: true, module: class {}, providers: [], exports: [] }),
      registerQueue: (...opts: Array<{ name: string }>) => {
        const providers = opts.map((o) => makeQueueProvider(o.name));
        return { module: class {}, providers, exports: providers };
      },
    },
    getQueueToken: queueToken,
    // 参数装饰器：写 SELF_DECLARED_DEPS_METADATA（与真 Inject 装饰器同构），
    // 让 @InjectQueue(...) 构造参数按队列 token 解析（与 registerQueue 提供的 provider 对上）
    InjectQueue: (name: string) => {
      const token = queueToken(name);
      return (target: object, _key: unknown, index: number) => {
        const deps =
          (Reflect.getMetadata('self:paramtypes', target) as Array<{ index: number; param: unknown }> | undefined) ??
          [];
        deps.push({ index, param: token });
        Reflect.defineMetadata('self:paramtypes', deps, target);
      };
    },
    WorkerHost: class {},
    // 批3 兼容：空操作类装饰器（@Processor(queueName, opts) 不建真实 Worker 连接）
    Processor: () => () => {},
  };
});

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { RefundModule } from '../src/modules/refund/refund.module';
import { IdempotencyModule } from '../src/shared/idempotency';
import { RefundService } from '../src/modules/refund/refund.service';
import { NotificationEventService } from '../src/modules/notification/notification-event.service';

let app: INestApplication;

beforeAll(async () => {
  // 方式一（主断言）：单独 assemble RefundModule——验证模块自身 imports 齐全
  const moduleRef = await Test.createTestingModule({
    // IdempotencyModule 在生产是 @Global（AppModule 注册）；RefundModule 单独
    // assemble 时补 import，让 OrderModule 的 OrderController 注入成立
    imports: [RefundModule, IdempotencyModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('RefundModule 真 DI 装配（批1 审查 P1-1）', () => {
  it('P1-1：DI 容器解析 RefundService → notificationEvents 非 undefined（装配闭合，非静默 no-op）', async () => {
    const refundService = app.get(RefundService);
    // 审查 P1-1 断链形态：@Optional 下缺 NotificationModule 时此值为 undefined，
    // if (this.notificationEvents) 恒假 → 通知静默不发
    expect(refundService['notificationEvents']).toBeDefined();
    expect(refundService['notificationEvents']).not.toBeNull();
  });

  it('P1-1：通知门面是 NotificationEventService 实例（token useExisting 透传正确）', async () => {
    const refundService = app.get(RefundService);
    const events = refundService['notificationEvents'] as unknown;
    expect(events).toBeInstanceOf(NotificationEventService);
  });

});
