/**
 * Home Controller - 首页活动入口（PromoDock）
 *
 * 路线 A 配置接口：GET /client/home-entries 返常驻 4 入口配置。
 * - @Public：跟 /client/categories、/client/banners 同模式（公开浏览型）
 * - 三概念分离：活动入口（本端点）≠ Banner 轮播（catalog）≠ 优惠券（promotion）
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { HomeService } from './home.service';
import { Public } from '../../shared/decorators/public.decorator';

@Controller('api/v1/client/home-entries')
@Public()
export class ClientHomeController {
  constructor(@Inject(HomeService) private readonly home: HomeService) {}

  /** 首页活动入口列表（按 sortOrder 升序，仅 ACTIVE） */
  @Get()
  async listEntries() {
    const data = await this.home.listEntries();
    return { success: true, data };
  }
}
