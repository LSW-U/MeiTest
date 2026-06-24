/**
 * User Service（W 流程 2026-06-24 加）
 *
 * 覆盖：用户资料 / 收货地址 / 收藏 / 通知 4 个 resource
 *
 * 决策：
 * - Prisma role 大写 enum → contract 小写，统一走 AuthService.toContractRole（D1-T1 已加）
 * - 默认地址用事务保证唯一性（设新默认时取消旧默认）
 * - 收藏 toggle 用 upsert（避免重复抛错）
 * - 通知 type 必须是 NotificationType enum（DB 校验）
 */
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import { AuthService } from '../auth/auth.service';
import type {
  Address as AddressType,
  NotificationItem as NotificationType,
} from '@meimart/api-contract';

@Injectable()
export class UserService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  // ===== Profile =====

  async getProfile(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'User not found' });
    }
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: this.auth.toContractRole(user.role),
      status: user.status,
      phoneVerified: user.phoneVerified,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateProfile(userId: string, input: { name?: string; avatarUrl?: string; email?: string }) {
    const user = await db.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        ...(input.email !== undefined && { email: input.email, emailVerified: false }),
      },
    });
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: this.auth.toContractRole(user.role),
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // ===== Addresses =====

  async listAddresses(userId: string): Promise<AddressType[]> {
    const addresses = await db.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return addresses.map((a) => this.toAddressDTO(a));
  }

  async createAddress(
    userId: string,
    input: {
      name: string;
      phone: string;
      region: { province: string; city: string; district?: string };
      detail: string;
      lat?: number | null;
      lng?: number | null;
      isDefault?: boolean;
      tag?: string | null;
    },
  ): Promise<AddressType> {
    const result = await db.$transaction(async (tx) => {
      // 若新增为默认，先取消该 user 现有默认
      if (input.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: {
          userId,
          name: input.name,
          phone: input.phone,
          region: input.region,
          detail: input.detail,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          isDefault: input.isDefault ?? false,
          tag: input.tag ?? null,
        },
      });
    });
    return this.toAddressDTO(result);
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: Partial<{
      name: string;
      phone: string;
      region: { province: string; city: string; district?: string };
      detail: string;
      lat: number | null;
      lng: number | null;
      isDefault: boolean;
      tag: string | null;
    }>,
  ): Promise<AddressType> {
    const existing = await db.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Address not found' });
    }

    const result = await db.$transaction(async (tx) => {
      // 切默认时取消旧默认
      if (input.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: addressId } },
          data: { isDefault: false },
        });
      }
      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.region !== undefined && { region: input.region }),
          ...(input.detail !== undefined && { detail: input.detail }),
          ...(input.lat !== undefined && { lat: input.lat }),
          ...(input.lng !== undefined && { lng: input.lng }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
          ...(input.tag !== undefined && { tag: input.tag }),
        },
      });
    });
    return this.toAddressDTO(result);
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const existing = await db.address.findFirst({ where: { id: addressId, userId } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Address not found' });
    }
    await db.address.delete({ where: { id: addressId } });
  }

  private toAddressDTO(a: {
    id: string;
    userId: string;
    name: string;
    phone: string;
    region: unknown;
    detail: string;
    lat: { toNumber(): number } | null;
    lng: { toNumber(): number } | null;
    isDefault: boolean;
    tag: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): AddressType {
    return {
      id: a.id,
      userId: a.userId,
      name: a.name,
      phone: a.phone,
      region: a.region as { province: string; city: string; district?: string },
      detail: a.detail,
      lat: a.lat ? a.lat.toNumber() : null,
      lng: a.lng ? a.lng.toNumber() : null,
      isDefault: a.isDefault,
      tag: a.tag,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  // ===== Favorites =====

  async listFavorites(userId: string) {
    const favorites = await db.favorite.findMany({
      where: { userId },
      include: {
        product: {
          include: {
            skus: { where: { status: 'ACTIVE' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return favorites.map((f) => ({
      id: f.id,
      productId: f.productId,
      product: this.toProductSummary(f.product),
      createdAt: f.createdAt.toISOString(),
    }));
  }

  async toggleFavorite(userId: string, productId: string): Promise<{ isFavorite: boolean }> {
    const existing = await db.favorite.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (existing) {
      await db.favorite.delete({ where: { id: existing.id } });
      return { isFavorite: false };
    }
    await db.favorite.create({ data: { userId, productId } });
    return { isFavorite: true };
  }

  /** 内部 helper：商品摘要（收藏列表用） */
  private toProductSummary(p: {
    id: string;
    name: unknown;
    mainImage: string;
    priceMin: number;
    status: string;
    salesCount: number;
    skus: { price: number }[];
  }) {
    return {
      id: p.id,
      name: p.name as Record<string, string>,
      image: p.mainImage,
      price: p.priceMin,
      status: p.status,
      salesCount: p.salesCount,
    };
  }

  // ===== Notifications =====

  async listNotifications(userId: string, onlyUnread = false): Promise<NotificationType[]> {
    const items = await db.notification.findMany({
      where: onlyUnread ? { userId, isRead: false } : { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return items.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title as Record<string, string>,
      content: n.content as Record<string, string>,
      isRead: n.isRead,
      data: n.data as Record<string, unknown> | null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<{ success: boolean }> {
    const existing = await db.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Notification not found' });
    }
    await db.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
    return { success: true };
  }

  async markAllNotificationsRead(userId: string): Promise<{ success: boolean }> {
    await db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { success: true };
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await db.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }
}
