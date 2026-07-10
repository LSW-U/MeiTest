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
import { Injectable, Inject, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';
import { AuthService } from '../auth/auth.service';
import { passwordStrategy } from '../../infrastructure/otp/password.strategy';
import { Address, NotificationItem } from '@meimart/api-contract';

type AddressDTO = z.infer<typeof Address>;
type NotificationDTO = z.infer<typeof NotificationItem>;

/** 后台用户列表项（W7 P1-2） */
export interface AdminUserListItem {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** contract 小写角色（'customer' / 'rider' / 等） */
  role: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  phoneVerified: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** 已成交订单数（DELIVERED_PAID + COMPLETED，不含未支付/未派单/CANCELLED） */
  orderCount: number;
  /** 已成交订单 payableAmount 总和（DELIVERED_PAID + COMPLETED，单位：分） */
  totalSpent: number;
}

@Injectable()
export class UserService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  // ===== Profile =====

  async getProfile(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'E-USER-007', message: 'User not found' });
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

  async listAddresses(userId: string): Promise<AddressDTO[]> {
    const addresses = await db.address.findMany({
      where: { userId, deletedAt: null },
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
  ): Promise<AddressDTO> {
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
  ): Promise<AddressDTO> {
    const existing = await db.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'E-USER-007', message: 'Address not found' });
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
    const existing = await db.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'E-USER-007', message: 'Address not found' });
    }
    // 软删除：地址可能被 Order 引用为 shippingAddress，硬删后历史订单看不到收货地址
    await db.address.update({ where: { id: addressId }, data: { deletedAt: new Date() } });
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
  }): AddressDTO {
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

  async listNotifications(userId: string, onlyUnread = false): Promise<NotificationDTO[]> {
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
      throw new NotFoundException({ code: 'E-USER-007', message: 'Notification not found' });
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

  // ===== Admin: 用户管理 =====

  /**
   * 后台用户列表（W7 P1-2）
   *
   * 筛选：keyword（name/phone/email 模糊）/ role / status
   * 分页：page + pageSize（offset-based，简单分页足够 MVP）
   * 聚合：orderCount（用户订单数）+ totalSpent（DELIVERED_PAID/COMPLETED 订单 payableAmount 总和）
   *
   * 不返回 password 字段（敏感）。
   */
  async listUsers(opts: {
    keyword?: string;
    role?: 'SUPER_ADMIN' | 'CUSTOMER' | 'RIDER' | 'WAREHOUSE_STAFF' | 'CUSTOMER_SERVICE';
    status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    items: AdminUserListItem[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {};
    if (opts.role) where.role = opts.role;
    if (opts.status) where.status = opts.status;
    if (opts.keyword && opts.keyword.trim().length > 0) {
      const kw = opts.keyword.trim();
      where.OR = [
        { phone: { contains: kw, mode: 'insensitive' } },
        { email: { contains: kw, mode: 'insensitive' } },
        { name: { contains: kw, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      db.user.count({ where }),
    ]);

    // 聚合 orderCount + totalSpent（一次查所有用户 ID，避免 N+1）
    // orderCount 语义 = 已成交订单数（DELIVERED_PAID + COMPLETED），不含未支付/未派单/CANCELLED
    const userIds = items.map((u) => u.id);
    const orderAgg = userIds.length
      ? await db.order.groupBy({
          by: ['userId'],
          where: {
            userId: { in: userIds },
            status: { in: ['DELIVERED_PAID', 'COMPLETED'] },
          },
          _count: { _all: true },
          _sum: { payableAmount: true },
        })
      : [];
    const aggMap = new Map<string, { count: number; total: number }>();
    for (const a of orderAgg) {
      aggMap.set(a.userId, {
        count: a._count._all,
        total: a._sum.payableAmount ?? 0,
      });
    }

    return {
      items: items.map((u) => {
        const agg = aggMap.get(u.id) ?? { count: 0, total: 0 };
        return {
          id: u.id,
          phone: u.phone,
          email: u.email,
          name: u.name,
          avatarUrl: u.avatarUrl,
          role: this.auth.toContractRole(u.role),
          status: u.status,
          phoneVerified: u.phoneVerified,
          emailVerified: u.emailVerified,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
          createdAt: u.createdAt.toISOString(),
          orderCount: agg.count,
          totalSpent: agg.total,
        };
      }),
      page,
      pageSize,
      total,
      hasMore: skip + items.length < total,
    };
  }

  // ===== W7-feature 客户管理详情/动作端点（2026-07-10） =====

  /** GET /:id - 用户详情（含最近 5 订单 + 全部地址） */
  async getUserDetail(id: string) {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'E-ADMIN-USER-001', message: '用户不存在' });
    }
    return this.buildAdminUserDetail(user);
  }

  /** PATCH /:id - 编辑客户资料 */
  async updateUser(id: string, input: UpdateUserInput, actorId: string) {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'E-ADMIN-USER-001', message: '用户不存在' });
    }
    // 防 super_admin 降级自己（防止自封）
    if (id === actorId && input.role !== undefined && input.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'E-ADMIN-USER-005',
        message: '不能降级自己的 role（防自封）',
      });
    }
    try {
      const updated = await db.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.email !== undefined && {
            email: input.email,
            // W7-fix（审查 #10）：改 email 后重置 emailVerified=false，与 updateProfile 一致
            // 除非管理员显式指定 emailVerified（input.emailVerified === undefined 时才重置）
            ...(input.emailVerified === undefined && { emailVerified: false }),
          }),
          ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.phoneVerified !== undefined && { phoneVerified: input.phoneVerified }),
          ...(input.emailVerified !== undefined && { emailVerified: input.emailVerified }),
        },
      });
      // W7-fix（审查 #3/#4/#18）：直接用 update 返回的 updated 构建 DTO，避免 getUserDetail 重复 findUnique
      return this.buildAdminUserDetail(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'E-ADMIN-USER-002',
          message: '手机号或邮箱已被其他用户占用',
        });
      }
      throw err;
    }
  }

  /** POST /:id/suspend - 暂停用户（status -> SUSPENDED） */
  async suspendUser(id: string, actorId: string) {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'E-ADMIN-USER-001', message: '用户不存在' });
    }
    if (id === actorId) {
      throw new ForbiddenException({
        code: 'E-ADMIN-USER-005',
        message: '不能暂停自己',
      });
    }
    if (user.role === 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'E-ADMIN-USER-004',
        message: '不能暂停其他 super_admin',
      });
    }
    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      throw new ConflictException({
        code: 'E-ADMIN-USER-003',
        message: `当前 status=${user.status}，无需暂停`,
      });
    }
    const updated = await db.user.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });
    return this.buildAdminUserDetail(updated);
  }

  /** POST /:id/activate - 激活用户（仅从 SUSPENDED 转 ACTIVE） */
  async activateUser(id: string) {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'E-ADMIN-USER-001', message: '用户不存在' });
    }
    if (user.status !== 'SUSPENDED') {
      throw new ConflictException({
        code: 'E-ADMIN-USER-003',
        message: `仅允许从 SUSPENDED 激活，当前 status=${user.status}`,
      });
    }
    const updated = await db.user.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    return this.buildAdminUserDetail(updated);
  }

  /** POST /:id/delete - 软删除用户（status -> DELETED，终态） */
  async deleteUser(id: string, actorId: string) {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'E-ADMIN-USER-001', message: '用户不存在' });
    }
    if (id === actorId) {
      throw new ForbiddenException({
        code: 'E-ADMIN-USER-005',
        message: '不能删除自己',
      });
    }
    if (user.role === 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: 'E-ADMIN-USER-004',
        message: '不能删除其他 super_admin',
      });
    }
    if (user.status === 'DELETED') {
      throw new ConflictException({
        code: 'E-ADMIN-USER-003',
        message: '用户已删除',
      });
    }
    const updated = await db.user.update({
      where: { id },
      data: { status: 'DELETED' },
    });
    return this.buildAdminUserDetail(updated);
  }

  /** POST /:id/reset-password - 重置密码（生成 12 字符临时密码） */
  async resetUserPassword(id: string): Promise<{
    temporaryPassword: string;
    generatedAt: string;
  }> {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'E-ADMIN-USER-001', message: '用户不存在' });
    }
    if (user.status === 'DELETED') {
      throw new ConflictException({
        code: 'E-ADMIN-USER-003',
        message: '不能给已删除用户重置密码',
      });
    }
    // 12 字符 base64url 临时密码（含字母+数字，URL 安全，无 +/=）
    // randomBytes(9) -> 9 字节 = 72 位 -> 12 个 base64url 字符（无 padding）
    // slice(0, 12) 是防御性编程（randomBytes(9) 正好 12 字符，未来改回 randomBytes(6) 也不会出错）
    const plain = randomBytes(9).toString('base64url').slice(0, 12);
    const hashed = await passwordStrategy.hashPassword(plain);
    await db.user.update({
      where: { id },
      data: {
        password: hashed,
        // W7-fix（审查 P0 #2）：更新 passwordChangedAt，refresh 端点检查 token.iat < passwordChangedAt 拒绝旧 token
        passwordChangedAt: new Date(),
      },
    });
    return {
      temporaryPassword: plain,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 根据 user 记录构建 AdminUserDetail DTO（并行查 orders/addresses/agg）
   *
   * W7-fix（审查 #3/#4/#18）：update/suspend/activate 已从 update 拿到最新 user，
   * 直接传进来避免重复 findUnique
   */
  private async buildAdminUserDetail(user: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
    role: string;
    status: string;
    phoneVerified: boolean;
    emailVerified: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const [recentOrders, addresses, agg] = await Promise.all([
      db.order.findMany({
        where: { userId: user.id, status: { in: ['DELIVERED_PAID', 'COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderNo: true,
          status: true,
          payableAmount: true,
          createdAt: true,
        },
      }),
      db.address.findMany({
        where: { userId: user.id, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
      db.order.aggregate({
        where: {
          userId: user.id,
          status: { in: ['DELIVERED_PAID', 'COMPLETED'] },
        },
        _count: { _all: true },
        _sum: { payableAmount: true },
      }),
    ]);
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: this.auth.toContractRole(user.role as never),
      status: user.status,
      phoneVerified: user.phoneVerified,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      orderCount: agg._count._all,
      totalSpent: agg._sum.payableAmount ?? 0,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        payableAmount: o.payableAmount,
        createdAt: o.createdAt.toISOString(),
      })),
      addresses: addresses.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.name,
        phone: a.phone,
        region: a.region as { province: string; city: string; district?: string | null },
        detail: a.detail,
        lat: a.lat !== null ? Number(a.lat) : null,
        lng: a.lng !== null ? Number(a.lng) : null,
        isDefault: a.isDefault,
        tag: a.tag,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    };
  }
}

type UpdateUserInput = {
  name?: string;
  phone?: string;
  email?: string | null;
  avatarUrl?: string;
  role?: 'SUPER_ADMIN' | 'CUSTOMER' | 'RIDER' | 'WAREHOUSE_STAFF' | 'CUSTOMER_SERVICE';
  phoneVerified?: boolean;
  emailVerified?: boolean;
};
