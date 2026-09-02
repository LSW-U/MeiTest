/**
 * Admin Dispatch Controller — 后台配送调度看板（批次 4）
 *
 * 端点（/api/v1/admin/dispatch）：
 *   GET    /tasks                       全任务监控（游标 + filter status/warehouseId/riderId/orderNo）
 *   GET    /tasks/:id                   详情（含 order + rider）
 *   POST   /tasks/:id/reassign          改派骑手（SUPER_ADMIN；第一期 ASSIGNED only；事务双写）
 *   POST   /tasks/:id/cancel            取消任务（SUPER_ADMIN；PENDING_ASSIGN/ASSIGNED；事务双写）
 *   GET    /riders/available            可派骑手（APPROVED + Redis isOnline 标记）
 *   POST   /orders/:orderId/recreate    补建任务（SUPER_ADMIN；复用 createTaskForOrder，幂等）
 *
 * 权限：
 *   - 读（list/detail/available）：SUPER_ADMIN + CUSTOMER_SERVICE（客服查进度）
 *   - 写（reassign/cancel/recreate）：仅 SUPER_ADMIN（对齐 payment/refund 写收紧模式）
 *
 * 审计：reassign/cancel 不写 OrderEvent（不改订单状态），靠 @Audit AuditLog + DeliveryTask.note 留痕
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Inject,
  HttpException,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ListAllTasksQuery,
  ReassignTaskRequest,
  AssignTaskRequest,
  CancelTaskRequest,
} from '@meimart/api-contract';
import { DispatchService } from './dispatch.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/admin/dispatch')
@Roles('SUPER_ADMIN', 'CUSTOMER_SERVICE')
export class AdminDispatchController {
  constructor(@Inject(DispatchService) private readonly dispatchService: DispatchService) {}

  /** 任务监控列表（游标 + filter） */
  @Get('tasks')
  async list(@Query(new ZodValidationPipe(ListAllTasksQuery)) query: z.infer<typeof ListAllTasksQuery>) {
    const result = await this.dispatchService.listAllTasks({
      status: query.status,
      warehouseId: query.warehouseId,
      riderId: query.riderId,
      orderNo: query.orderNo,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 任务详情（含 order + rider） */
  @Get('tasks/:id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const result = await this.dispatchService.getAdminDetail(id);
    return { success: true as const, data: result };
  }

  /** 改派骑手（仅 SUPER_ADMIN；第一期 ASSIGNED only） */
  @Post('tasks/:id/reassign')
  @Roles('SUPER_ADMIN')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'id' })
  async reassign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ReassignTaskRequest)) body: z.infer<typeof ReassignTaskRequest>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'auth required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.dispatchService.reassignTask({
      taskId: id,
      newRiderId: body.newRiderId,
      adminUserId: req.user.sub,
      reason: body.reason,
    });
    return { success: true as const, data: result };
  }

  /**
   * Admin 直接指派（批 F，2026-09-03，批E审查 P0-1 裁决方案 a）
   *
   * PENDING_ASSIGN 任务指派给指定骑手（派单中心「确认指派」消费）。
   * 保留保证金资格校验（E-DEPOSIT-201/202）；不校验工作仓（跨仓支援走此通道）。
   */
  @Post('tasks/:id/assign')
  @Roles('SUPER_ADMIN')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'id' })
  async assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AssignTaskRequest)) body: z.infer<typeof AssignTaskRequest>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'auth required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.dispatchService.assignTask({
      taskId: id,
      riderId: body.riderId,
      adminUserId: req.user.sub,
      reason: body.reason,
    });
    return { success: true as const, data: result };
  }

  /** 取消任务（仅 SUPER_ADMIN；PENDING_ASSIGN/ASSIGNED） */
  @Post('tasks/:id/cancel')
  @Roles('SUPER_ADMIN')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'id' })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(CancelTaskRequest)) body: z.infer<typeof CancelTaskRequest>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'auth required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.dispatchService.cancelTask({
      taskId: id,
      adminUserId: req.user.sub,
      reason: body.reason,
    });
    return { success: true as const, data: result };
  }

  /** 可派骑手（APPROVED + isOnline 标记，在线优先） */
  @Get('riders/available')
  async availableRiders() {
    const result = await this.dispatchService.listAvailableRiders();
    return { success: true as const, data: result };
  }

  /**
   * 派单候选（批 D，2026-09-03，方案 Q10/Q13）：资格过滤 + 排序推荐 + 资格标签
   *
   * query：crossWarehouse=true 放宽工作仓过滤（仅 admin 显式跨仓支援，资格校验保留）；
   *        includeIneligible=true 附带不合格候选（⛔需保证金 $Z 提示，默认剔除）
   */
  @Get('tasks/:id/candidates')
  @Roles('SUPER_ADMIN')
  async candidates(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(
      new ZodValidationPipe(
        z.object({
          crossWarehouse: z.coerce.boolean().optional(),
          includeIneligible: z.coerce.boolean().optional(),
        }),
      ),
    )
    query: { crossWarehouse?: boolean; includeIneligible?: boolean },
  ) {
    const result = await this.dispatchService.listDispatchCandidates({
      taskId: id,
      crossWarehouse: query.crossWarehouse,
      includeIneligible: query.includeIneligible,
    });
    return { success: true as const, data: result };
  }

  /**
   * 补建任务（仅 SUPER_ADMIN；复用 createTaskForOrder，幂等）
   *
   * 已有 DeliveryTask 直接返回（幂等）；订单不存在抛 E-ORDER-004
   */
  @Post('orders/:orderId/recreate')
  @Roles('SUPER_ADMIN')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'orderId' })
  async recreate(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
    const task = await this.dispatchService.createTaskForOrder(orderId);
    if (!task) {
      // createTaskForOrder 理论上不返回 null（找不到订单抛 E-ORDER-004，已存在返回 view）
      throw new HttpException(
        { code: 'E-DISPATCH-001', message: 'Task recreate returned null' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    // 返回 admin detail（含 order + rider 关联，新 task rider=null）
    const result = await this.dispatchService.getAdminDetail(task.id);
    return { success: true as const, data: result };
  }
}
