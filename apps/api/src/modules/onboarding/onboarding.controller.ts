/**
 * Onboarding Controllers — 引导页内容可配置（批1，2026-10-14）
 *
 * 2 controller：
 *   - ClientOnboardingController  GET /api/v1/client/onboarding/slides  @Public（首启无 token，匿名 curl 成立）
 *   - AdminOnboardingController   CRUD /api/v1/admin/onboarding/slides  @Roles('SUPER_ADMIN')
 *
 * 参照先例：ClientHomeController /client/home-entries 类级 @Public（公开配置下发）；
 * AdminBannerController CRUD 装配（ZodValidationPipe + @Audit + 物理删除）。
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateOnboardingSlideRequest,
  UpdateOnboardingSlideRequest,
} from '@meimart/api-contract';
import { OnboardingService } from './onboarding.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Public } from '../../shared/decorators/public.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

@Controller('api/v1/client/onboarding')
@Public()
export class ClientOnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  /** 引导页 slide 列表（enabled + sortOrder 升序；空表返回 []，客户端回退本地 SLIDES） */
  @Get('slides')
  async listSlides() {
    const data = await this.onboarding.listEnabledSlides();
    return { success: true, data };
  }
}

@Controller('api/v1/admin/onboarding')
@Roles('SUPER_ADMIN')
export class AdminOnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  /** 后台全量列表（含 disabled） */
  @Get('slides')
  async list() {
    const data = await this.onboarding.listAllSlides();
    return { success: true, data };
  }

  @Post('slides')
  @Audit({ resource: 'OnboardingSlide' })
  async create(
    @Body(new ZodValidationPipe(CreateOnboardingSlideRequest)) body: z.infer<typeof CreateOnboardingSlideRequest>,
  ) {
    const data = await this.onboarding.createSlide(body);
    return { success: true, data };
  }

  /** PATCH 部分字段（含 sortOrder、enabled toggle） */
  @Patch('slides/:id')
  @Audit({ resource: 'OnboardingSlide' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOnboardingSlideRequest)) body: z.infer<typeof UpdateOnboardingSlideRequest>,
  ) {
    const data = await this.onboarding.updateSlide(id, body);
    return { success: true, data };
  }

  /** 物理删除（Banner 同模式） */
  @Delete('slides/:id')
  @Audit({ resource: 'OnboardingSlide' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.onboarding.deleteSlide(id);
    return { success: true, data: null };
  }
}
