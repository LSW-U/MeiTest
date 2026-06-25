/**
 * Order Timeout Processor — BullMQ 消费者
 *
 * 决策依据：W3-C 任务分解 + 契约 v0.3 §订单状态机
 *
 * 触发条件：
 *   - createOrder 时入队 delayed job（默认 15min）
 *   - job 触发时检查 order.status：
 *     - PENDING_PAYMENT / PENDING_CONFIRM → 调 cancelIfPending（释放库存 + 标 CANCELLED）
 *     - 其他状态 → 跳过（订单已推进，无需取消）
 *
 * Job 数据：{ orderId: string, enqueuedStatus?: string }
 *
 * 重试策略：
 *   - 失败默认重试 3 次，每次间隔指数退避（BullMQ 默认）
 *   - 重试期间如果订单已推进，下次重试会跳过（幂等）
 *
 * Job ID 用 orderId（去重）：同 orderId 重复入队会保留第一个
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { OrderService } from './order.service';

/** 订单超时配置（毫秒） */
export const ORDER_TIMEOUT_MS = 15 * 60 * 1000; // 15 分钟

/** Job 数据 schema */
export interface OrderTimeoutJobData {
  orderId: string;
  /** 入队时的状态快照（信息性，处理器以 DB 当前状态为准） */
  enqueuedStatus?: string;
}

@Processor('order-timeout', { concurrency: 5 })
export class OrderTimeoutProcessor extends WorkerHost {
  private readonly otpLogger = new Logger(OrderTimeoutProcessor.name);

  constructor(private readonly orderService: OrderService) {
    super();
  }

  /**
   * 处理订单超时 job
   *
   * 幂等：订单若已推进到非 PENDING_* 状态则跳过
   */
  async process(job: Job<OrderTimeoutJobData>): Promise<void> {
    const { orderId } = job.data;
    this.otpLogger.log(
      `processing order timeout: orderId=${orderId} attempt=${job.attemptsMade + 1}`,
    );

    await this.orderService.cancelIfPending(orderId, {
      reason: 'ORDER_TIMEOUT_15MIN',
    });
  }
}
