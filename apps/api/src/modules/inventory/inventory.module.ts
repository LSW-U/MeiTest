/** Inventory Module（W 流程 2026-06-24） */
import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ClientInventoryController, AdminInventoryController } from './inventory.controller';

@Module({
  controllers: [ClientInventoryController, AdminInventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
