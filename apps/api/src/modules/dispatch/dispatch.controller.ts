/**
 * Dispatch Controller — 骑手端配送调度路由
 *
 * 路由前缀 /api/v1/rider/dispatch（deviceType=rider_app，role=rider）
 *
 * 端点：
 *   GET    /tasks              抢单大厅（待派送订单池，可选 warehouseId 过滤）
 *   POST   /tasks/:id/accept   抢单（乐观锁防重复抢）
 *   POST   /tasks/:id/pickup   上报取货（ASSIGNED → PICKED_UP）
 *   POST   /tasks/:id/deliver  上报送达（PICKED_UP → DELIVERED + COD 收款记录）
 *   POST   /tasks/:id/report-issue  异常上报（CUSTOMER_UNREACHABLE / REJECTED 等）
 *
 * WS 事件（server → riders room）：
 *   - dispatch:new-task       新订单可抢
 *   - dispatch:task-accepted  任务已被抢（前端从大厅移除）
 *   - order:status            订单状态变更（取货/送达，推给客户端）
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { z } from 'zod';
import {
  PickupTaskRequest,
  DeliverTaskRequest,
  ReportIssueRequest,
} from '@meimart/api-contract';
import { DispatchService } from './dispatch.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

const ListTasksQuery = z.object({
  warehouseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/rider/dispatch')
@Roles('rider')
export class DispatchController {
  constructor(@Inject(DispatchService) private readonly dispatchService: DispatchService) {}

  /** 抢单大厅查询 */
  @Get('tasks')
  async listTasks(
    @Query(new ZodValidationPipe(ListTasksQuery)) query: z.infer<typeof ListTasksQuery>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const result = await this.dispatchService.listPendingTasks({
      riderId: user.sub,
      warehouseId: query.warehouseId,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 抢单 */
  @Post('tasks/:id/accept')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'id' })
  async acceptTask(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const task = await this.dispatchService.acceptTask({
      riderId: user.sub,
      taskId: id,
    });
    return { success: true as const, data: task };
  }

  /** 上报取货 */
  @Post('tasks/:id/pickup')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'id' })
  async pickupTask(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(PickupTaskRequest)) body: z.infer<typeof PickupTaskRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const task = await this.dispatchService.pickupTask({
      riderId: user.sub,
      taskId: id,
      note: body.note,
    });
    return { success: true as const, data: task };
  }

  /** 上报送达（COD 场景传 collectedAmount） */
  @Post('tasks/:id/deliver')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'id' })
  async deliverTask(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(DeliverTaskRequest)) body: z.infer<typeof DeliverTaskRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const task = await this.dispatchService.deliverTask({
      riderId: user.sub,
      taskId: id,
      collectedAmount: body.collectedAmount,
      note: body.note,
    });
    return { success: true as const, data: task };
  }

  /** 异常上报 */
  @Post('tasks/:id/report-issue')
  @Audit({ resource: 'DeliveryTask', resourceIdParam: 'id' })
  async reportIssue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ReportIssueRequest)) body: z.infer<typeof ReportIssueRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const task = await this.dispatchService.reportIssue({
      riderId: user.sub,
      taskId: id,
      reason: body.reason,
      note: body.note,
    });
    return { success: true as const, data: task };
  }
}
