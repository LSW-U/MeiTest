/**
 * Profile Module — 共享用户画像聚合（客户画像批1 2026-10-18）
 *
 * 批 2~6 共同地基：
 *   - ProfileService.getCustomerProfile360  单客七维聚合（口径同源 R-a）
 *   - CustomerNoteService                   D6 客户标记 CRUD
 *   - AdminProfileController                /admin/users/:id/profile + /:id/notes（G7 挂 /admin/users 旁）
 *
 * 后续批次消费方式：import { ProfileModule, ProfileService }（本 module exports）。
 */
import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { CustomerNoteService } from './customer-note.service';
import { AdminProfileController } from './admin-profile.controller';
import { BehaviorInsightService } from '../engagement/behavior-insight.service';
import { BEHAVIOR_INSIGHT_SERVICE_TOKEN } from './profile.tokens';

@Module({
  controllers: [AdminProfileController],
  providers: [
    ProfileService,
    CustomerNoteService,
    BehaviorInsightService,
    { provide: BEHAVIOR_INSIGHT_SERVICE_TOKEN, useExisting: BehaviorInsightService },
  ],
  exports: [ProfileService, CustomerNoteService],
})
export class ProfileModule {}
