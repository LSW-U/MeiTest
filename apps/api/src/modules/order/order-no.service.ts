/**
 * OrderNo 生成服务（Redis INCR order:seq:{date}:{whCode}）
 *
 * 决策依据：CLAUDE.md §orderNo 格式 + 契约 v0.3 决策 A
 *   格式：MM + yyyyMMdd(8) + warehouseId(2位) + 序号(4位) = 16 位
 *   序号由 Redis INCR 生成，首次 INCR 设置 2 天 TTL（跨日重置）
 *   单仓单日上限 9999 单（4 位最大值，MVP 远超需求）
 *
 * 设计：
 *   - 用 INCR 原子操作，多请求并发安全
 *   - 首次 INCR 时设置 TTL，避免 Redis 重启后序号重置碰撞历史 orderNo
 *     （即使 Redis 重启丢序号，2 天内重复概率极低，业务可接受）
 *   - 时区：Asia/Dili (UTC+9)，与业务日期一致
 *
 * 用法：
 *   const orderNo = await orderNoService.nextOrderNo(warehouseCode);
 */
import { Injectable } from '@nestjs/common';
import { formatOrderNo, getOrderSeqKey } from '@meimart/shared-utils';
import { redis } from '../../shared/cache';

/** 单仓单日序号上限（4 位最大值，到顶抛错） */
const MAX_DAILY_SEQ = 9999;

/** Redis TTL（秒）：2 天 = 跨日 + buffer */
const SEQ_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

@Injectable()
export class OrderNoService {
  /**
   * 生成下一个 orderNo
   *
   * @param warehouseCode 仓库代码 2 位字符串（"01" / "02" / ...）
   * @returns 16 位 orderNo（如 "MM2026062301000023"）
   * @throws Error('ORDER_NO_SEQUENCE_OVERFLOW') 单仓单日超过 9999
   */
  async nextOrderNo(warehouseCode: string): Promise<string> {
    if (!/^\d{2}$/.test(warehouseCode)) {
      throw new Error(`ORDER_NO_WAREHOUSE_CODE_FORMAT: must be 2 digits, got "${warehouseCode}"`);
    }

    const date = this.getBusinessDate();
    const key = getOrderSeqKey(date, warehouseCode);

    // INCR 原子自增（首次会从 0 自增到 1）
    const seq = await redis.incr(key);

    // 首次创建时设置 TTL（避免无限累积 + 重启后历史序号复活）
    if (seq === 1) {
      await redis.expire(key, SEQ_KEY_TTL_SECONDS);
    }

    if (seq > MAX_DAILY_SEQ) {
      // 触顶，单仓单日超过 9999 单（MVP 几乎不可能，但 fail-fast 避免重复）
      throw new Error(
        `ORDER_NO_SEQUENCE_OVERFLOW: warehouse ${warehouseCode} date ${date} seq ${seq} > ${MAX_DAILY_SEQ}`,
      );
    }

    return formatOrderNo(date, warehouseCode, seq);
  }

  /**
   * 取业务日期（Asia/Dili 时区 yyyyMMdd）
   *
   * 用 Intl.DateTimeFormat 而非手动偏移（UTC+9 计算易错，夏令时不存在东帝汶无 DST）
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
