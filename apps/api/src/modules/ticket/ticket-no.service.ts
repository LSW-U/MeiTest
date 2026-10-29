/**
 * TicketNo 生成服务（Redis INCR ticket:seq:{date}）
 *
 * 替换品批2 工单化（2026-10-29，方案v2 D12）
 *   格式：TK + yyyyMMdd(8) + 序号(6位) = 16 位（与 ticket_no VARCHAR(16) 同长）
 *   序号由 Redis INCR 生成，首次 INCR 设置 2 天 TTL（跨日重置）
 *   照抄 OrderNoService 模式（INCR 原子安全 / TTL 防重启复活 / Asia/Dili 业务日）
 *
 * 用法：
 *   const ticketNo = await ticketNoService.nextTicketNo();
 */
import { Injectable } from '@nestjs/common';
import { redis } from '../../shared/cache';

/** 单日序号上限（6 位最大值，到顶抛错 fail-fast 避免重复） */
const MAX_DAILY_SEQ = 999999;

/** Redis TTL（秒）：2 天 = 跨日 + buffer */
const SEQ_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

@Injectable()
export class TicketNoService {
  /**
   * 生成下一个 ticketNo
   *
   * @returns 16 位工单号（如 "TK20261029000001"）
   * @throws Error('TICKET_NO_SEQUENCE_OVERFLOW') 单日超过 999999
   */
  async nextTicketNo(): Promise<string> {
    const date = this.getBusinessDate();
    const key = `ticket:seq:${date}`;

    // INCR 原子自增（首次会从 0 自增到 1）
    const seq = await redis.incr(key);

    // 首次创建时设置 TTL（避免无限累积 + 重启后历史序号复活）
    if (seq === 1) {
      await redis.expire(key, SEQ_KEY_TTL_SECONDS);
    }

    if (seq > MAX_DAILY_SEQ) {
      throw new Error(`TICKET_NO_SEQUENCE_OVERFLOW: date ${date} seq ${seq} > ${MAX_DAILY_SEQ}`);
    }

    return `TK${date}${String(seq).padStart(6, '0')}`;
  }

  /**
   * 取业务日期（Asia/Dili 时区 yyyyMMdd）
   *
   * 用 Intl.DateTimeFormat 而非手动偏移（与 OrderNoService 同款实现）
   */
  private getBusinessDate(): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dili',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA 输出 yyyy-MM-dd，去横线得 yyyyMMdd
    return formatter.format(new Date()).replace(/-/g, '');
  }
}
