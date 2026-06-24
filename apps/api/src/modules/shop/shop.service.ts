/**
 * Shop Service（W 流程 2026-06-24）
 *
 * 单一商家：MVP 仅 1 条预置 shop（platform 自营）
 *
 * 决策：
 * - 客户端 GET /common/shop 任何人可访问（Public，无需登录）
 * - 后台 PATCH /admin/shop 仅 super_admin
 * - 多语言字段（name/announcement）以 JSON 形式整体替换
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';

@Injectable()
export class ShopService {
  /** 获取唯一 shop（取第一条） */
  async getShop() {
    const shop = await db.shop.findFirst();
    if (!shop) {
      throw new NotFoundException({
        code: 'E-SHOP-001',
        message: 'Shop not initialized (need seed)',
      });
    }
    return this.toDTO(shop);
  }

  /** 更新 shop 信息（部分字段） */
  async updateShop(
    input: Partial<{
      name: Record<string, string>;
      announcement: Record<string, string>;
      logoUrl: string | null;
      phone: string;
      address: string;
      status: 'ACTIVE' | 'INACTIVE';
      businessHours: unknown;
    }>,
  ) {
    const existing = await db.shop.findFirst();
    if (!existing) {
      throw new NotFoundException({
        code: 'E-SHOP-001',
        message: 'Shop not initialized (need seed)',
      });
    }
    const updated = await db.shop.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined && { name: input.name as Prisma.InputJsonValue }),
        ...(input.announcement !== undefined && { announcement: input.announcement as Prisma.InputJsonValue }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.status !== undefined && { status: input.status as 'ACTIVE' | 'INACTIVE' }),
        ...(input.businessHours !== undefined && { businessHours: input.businessHours as Prisma.InputJsonValue }),
      },
    });
    return this.toDTO(updated);
  }

  private toDTO(s: {
    id: string;
    name: unknown;
    announcement: unknown;
    logoUrl: string | null;
    phone: string;
    address: string;
    lat: { toNumber(): number };
    lng: { toNumber(): number };
    status: string;
    businessHours: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      name: s.name as Record<string, string>,
      announcement: (s.announcement ?? null) as Record<string, string> | null,
      logoUrl: s.logoUrl,
      phone: s.phone,
      address: s.address,
      lat: s.lat.toNumber(),
      lng: s.lng.toNumber(),
      status: s.status as 'ACTIVE' | 'INACTIVE',
      businessHours: s.businessHours,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
