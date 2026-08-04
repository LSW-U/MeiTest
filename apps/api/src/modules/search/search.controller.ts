/**
 * Search Controllers — 热搜（客户端 + admin）
 *
 * - ClientSearchController  /api/v1/client/search/hot   @Public（未登录也能看热搜）
 * - AdminHotSearchController /api/v1/admin/hot-search/*  SUPER_ADMIN（运营管理）
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { detectLanguage } from '@meimart/shared-utils';
import { SearchService } from './search.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Public } from '../../shared/decorators/public.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import {
  CreateHotSearchTermRequest,
  UpdateHotSearchTermRequest,
} from '@meimart/api-contract';

@Controller('api/v1/client/search')
@Public()
export class ClientSearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  /** 热搜榜（limit 默认 6 最大 20，lang 从 Accept-Language detect） */
  @Get('hot')
  async hot(
    @Query('limit') limit?: string,
    @Headers('accept-language') acceptLang?: string,
  ) {
    const lang = detectLanguage(acceptLang);
    const lim = Math.min(Math.max(parseInt(limit ?? '6', 10) || 6, 1), 20);
    const data = await this.search.listHot(lang, lim);
    return { success: true, data };
  }

  /** 搜索建议 / 输入联想（C 方案词联想，三源合并；prefix < 1 返空） */
  @Get('suggest')
  async suggest(
    @Query('prefix') prefix?: string,
    @Query('limit') limit?: string,
    @Headers('accept-language') acceptLang?: string,
  ) {
    const lang = detectLanguage(acceptLang);
    const lim = Math.min(Math.max(parseInt(limit ?? '8', 10) || 8, 1), 20);
    const data = await this.search.suggest(prefix ?? '', lang, lim);
    return { success: true, data };
  }
}

@Controller('api/v1/admin/hot-search')
@Roles('SUPER_ADMIN')
export class AdminHotSearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  /** ZSET 真实热搜 top N（运营看热度） */
  @Get()
  async list(@Query('lang') lang?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const data = await this.search.adminListHot(lang, lim);
    return { success: true, data };
  }

  /** 运营种子词列表（HotSearchTerm 表，可按 lang/type 筛选） */
  @Get('terms')
  async listTerms(@Query('lang') lang?: string, @Query('type') type?: string) {
    const data = await this.search.listTerms(lang, type as z.infer<typeof CreateHotSearchTermRequest>['type'] | undefined);
    return { success: true, data };
  }

  /** 零结果词聚合（运营补商品依据） */
  @Get('zero-result')
  async zeroResult(@Query('lang') lang?: string) {
    const data = await this.search.listZeroResult(lang);
    return { success: true, data };
  }

  @Post('terms')
  async createTerm(
    @Body(new ZodValidationPipe(CreateHotSearchTermRequest))
    body: z.infer<typeof CreateHotSearchTermRequest>,
  ) {
    const data = await this.search.createTerm(body);
    return { success: true, data };
  }

  @Patch('terms/:id')
  async updateTerm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateHotSearchTermRequest))
    body: z.infer<typeof UpdateHotSearchTermRequest>,
  ) {
    const data = await this.search.updateTerm(id, body);
    return { success: true, data };
  }

  @Delete('terms/:id')
  async deleteTerm(@Param('id') id: string) {
    await this.search.deleteTerm(id);
    return { success: true, data: { id } };
  }
}
