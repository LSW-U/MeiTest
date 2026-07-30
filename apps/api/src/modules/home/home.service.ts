/**
 * Home Service - 首页活动入口（PromoDock）
 *
 * 路线 A 配置接口：零 DB 依赖，直接读代码常量 HOME_ENTRIES。
 * listEntries 过滤 ACTIVE + 按 sortOrder 升序；client 端不返 status 字段（配置层开关，客户端无意义）。
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HomeEntry } from '@meimart/api-contract';
import { HOME_ENTRIES } from './home.entries';

type HomeEntryData = z.infer<typeof HomeEntry>;
/** client 返回类型：剥离 status（过滤后全 ACTIVE，字段对客户端无意义） */
type HomeEntryClient = Omit<HomeEntryData, 'status'>;

@Injectable()
export class HomeService {
  /**
   * 返回首页活动入口（仅 ACTIVE，按 sortOrder 升序）
   *
   * - 过滤 status=INACTIVE（配置层开关，未来 system_config 表化时用）
   * - 按 sortOrder 升序
   * - 剥离 status 字段（client 不需要）
   * - 空数组合法（前端显空态）
   */
  /** source 默认 HOME_ENTRIES；传入自定义源可测过滤/排序逻辑 */
  async listEntries(source: HomeEntryData[] = HOME_ENTRIES): Promise<HomeEntryClient[]> {
    return source
      .filter((e) => e.status === 'ACTIVE')
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((e) => ({
        id: e.id,
        titleKey: e.titleKey,
        icon: e.icon,
        theme: e.theme,
        link: e.link,
        sortOrder: e.sortOrder,
      }));
  }
}
