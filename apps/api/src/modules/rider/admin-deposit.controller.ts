/**
 * AdminDeposit Controller — admin 侧保证金 7 组端点（批 C，2026-09-02）
 *
 * 路由（全部 SUPER_ADMIN，admin_web deviceType 由全局 DeviceTypeGuard 校验）：
 *   GET    /api/v1/admin/deposit/tiers                  档位列表
 *   POST   /api/v1/admin/deposit/tiers                  新增档位
 *   PATCH  /api/v1/admin/deposit/tiers/:id              编辑档位（派生上限实时生效）
 *   DELETE /api/v1/admin/deposit/tiers/:id              软停用档位
 *   GET    /api/v1/admin/deposit/locations              缴纳点列表
 *   POST   /api/v1/admin/deposit/locations              新增缴纳点
 *   PATCH  /api/v1/admin/deposit/locations/:id          编辑缴纳点
 *   DELETE /api/v1/admin/deposit/locations/:id          软停用缴纳点
 *   GET    /api/v1/admin/deposit/requests               申请列表（status 过滤+分页）
 *   POST   /api/v1/admin/deposit/requests/:id/confirm   确认收款（事务累加）
 *   POST   /api/v1/admin/deposit/requests/:id/reject    拒绝（adminNote 必填）
 *   GET    /api/v1/admin/riders/:id/detail              骑手聚合详情（Q8 ①-⑤）
 *   GET    /api/v1/admin/dispatch/warehouse-load        各仓负载
 *
 * 契约：packages/api-contract/src/schemas/rider.ts（Admin* 系列，批 C）
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
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminDepositService } from './admin-deposit.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

/** 档位新增 schema（与契约 AdminUpsertTierRequest 同步，refine 校验在 service 重复兜底） */
const CreateTierSchema = z
  .object({
    minAmount: z.number().int().positive(),
    maxOrderAmount: z.number().int().positive().nullable(),
    sortOrder: z.number().int().min(0),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.maxOrderAmount === null || v.maxOrderAmount > v.minAmount, {
    message: 'maxOrderAmount must be greater than minAmount (or null)',
    path: ['maxOrderAmount'],
  });

/** 档位编辑 schema（全可选；minAmount/maxOrderAmount 联动校验在 service 合并后兜底） */
const UpdateTierSchema = z.object({
  minAmount: z.number().int().positive().optional(),
  maxOrderAmount: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

/** 缴纳点新增 schema */
const CreateLocationSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().min(1).max(300),
  note: z.string().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
});

/** 缴纳点编辑 schema（局部） */
const UpdateLocationSchema = CreateLocationSchema.partial();

/** 申请列表 query */
const ListRequestsSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** confirm body */
const ConfirmRequestSchema = z.object({
  confirmedAmount: z.number().int().min(100).optional(),
  adminNote: z.string().max(500).optional(),
});

/** reject body（adminNote 必填） */
const RejectRequestSchema = z.object({
  adminNote: z.string().min(1).max(500),
});

/** :id uuid 参数（批 B P3-1 同款：非法 → 400 不落 500） */
const UuidParam = z.string().uuid();

@Controller('api/v1/admin/deposit')
@Roles('SUPER_ADMIN')
export class AdminDepositController {
  constructor(@Inject(AdminDepositService) private readonly depositService: AdminDepositService) {}

  // ===== 1. tiers =====

  @Get('tiers')
  async listTiers() {
    const items = await this.depositService.listTiers();
    return { success: true as const, data: items };
  }

  @Post('tiers')
  @Audit({ resource: 'RiderDepositTier' })
  async createTier(@Body(new ZodValidationPipe(CreateTierSchema)) body: z.infer<typeof CreateTierSchema>) {
    const tier = await this.depositService.createTier(body);
    return { success: true as const, data: tier };
  }

  @Patch('tiers/:id')
  @Audit({ resource: 'RiderDepositTier', resourceIdParam: 'id' })
  async updateTier(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdateTierSchema)) body: z.infer<typeof UpdateTierSchema>,
  ) {
    const tier = await this.depositService.updateTier(id, body);
    return { success: true as const, data: tier };
  }

  @Delete('tiers/:id')
  @Audit({ resource: 'RiderDepositTier', resourceIdParam: 'id' })
  async deleteTier(@Param('id', new ZodValidationPipe(UuidParam)) id: string) {
    return this.depositService.deleteTier(id);
  }

  // ===== 2. locations =====

  @Get('locations')
  async listLocations() {
    const items = await this.depositService.listLocations();
    return { success: true as const, data: items };
  }

  @Post('locations')
  @Audit({ resource: 'DepositLocation' })
  async createLocation(@Body(new ZodValidationPipe(CreateLocationSchema)) body: z.infer<typeof CreateLocationSchema>) {
    const location = await this.depositService.createLocation(body);
    return { success: true as const, data: location };
  }

  @Patch('locations/:id')
  @Audit({ resource: 'DepositLocation', resourceIdParam: 'id' })
  async updateLocation(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(UpdateLocationSchema)) body: z.infer<typeof UpdateLocationSchema>,
  ) {
    const location = await this.depositService.updateLocation(id, body);
    return { success: true as const, data: location };
  }

  @Delete('locations/:id')
  @Audit({ resource: 'DepositLocation', resourceIdParam: 'id' })
  async deleteLocation(@Param('id', new ZodValidationPipe(UuidParam)) id: string) {
    return this.depositService.deleteLocation(id);
  }

  // ===== 3/4/5. 申请列表 + confirm/reject =====

  @Get('requests')
  async listRequests(@Query(new ZodValidationPipe(ListRequestsSchema)) query: z.infer<typeof ListRequestsSchema>) {
    const data = await this.depositService.listRequests(query);
    return { success: true as const, data };
  }

  @Post('requests/:id/confirm')
  @Audit({ resource: 'RiderDeposit', resourceIdParam: 'id' })
  async confirm(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(ConfirmRequestSchema)) body: z.infer<typeof ConfirmRequestSchema>,
  ) {
    const result = await this.depositService.confirm(id, body);
    return { success: true as const, data: result };
  }

  @Post('requests/:id/reject')
  @Audit({ resource: 'RiderDeposit', resourceIdParam: 'id' })
  async reject(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body(new ZodValidationPipe(RejectRequestSchema)) body: z.infer<typeof RejectRequestSchema>,
  ) {
    const deposit = await this.depositService.reject(id, body);
    return { success: true as const, data: deposit };
  }
}

/**
 * 骑手聚合详情 + 仓负载（路由前缀不同，独立 controller）
 *   GET /api/v1/admin/riders/:id/detail
 *   GET /api/v1/admin/dispatch/warehouse-load
 */
@Controller('api/v1/admin')
@Roles('SUPER_ADMIN')
export class AdminDepositAggregateController {
  constructor(@Inject(AdminDepositService) private readonly depositService: AdminDepositService) {}

  @Get('riders/:id/detail')
  async riderDetail(@Param('id', new ZodValidationPipe(UuidParam)) id: string) {
    const data = await this.depositService.getRiderDepositDetail(id);
    return { success: true as const, data: data };
  }

  @Get('dispatch/warehouse-load')
  async warehouseLoad() {
    const items = await this.depositService.getWarehouseLoad();
    return { success: true as const, data: items };
  }
}
