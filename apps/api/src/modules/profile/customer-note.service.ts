/**
 * Customer Note Service — 客户内部标记/备注 CRUD（D6，客户画像批1 2026-10-18）
 *
 * 方案：方案v2 §三 批1 + v2 订正 #8（schema adminNote 在 RiderDeposit 不通用，勿复用勿撞名）
 *
 * 写操作审计由 AuditInterceptor（APP_GUARD 级）自动覆盖（POST/PATCH/DELETE）。
 * 错误码段位：E-PROFILE-001~099（新模块预留段，§3.4）。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';

/** 标记 DTO（契约 CustomerNoteItem 同形） */
export interface CustomerNoteItem {
  id: string;
  userId: string;
  type: string;
  content: string;
  createdBy: string;
  createdAt: string;
}

@Injectable()
export class CustomerNoteService {
  /** 列表（createdAt desc，最新在前） */
  async list(userId: string): Promise<CustomerNoteItem[]> {
    const rows = await db.customerNote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      type: r.type,
      content: r.content,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** 新增（写操作，审计由 interceptor 覆盖） */
  async create(
    userId: string,
    input: { type: string; content: string },
    actorId: string,
  ): Promise<CustomerNoteItem> {
    await this.ensureUser(userId);
    const row = await db.customerNote.create({
      data: { userId, type: input.type, content: input.content, createdBy: actorId },
    });
    return this.toDto(row);
  }

  /** 编辑（须归属同用户，防跨用户改 note） */
  async update(
    userId: string,
    noteId: string,
    input: { type?: string; content?: string },
    _actorId: string,
  ): Promise<CustomerNoteItem> {
    const row = await this.findOwned(userId, noteId);
    const updated = await db.customerNote.update({
      where: { id: row.id },
      data: {
        ...(input.type !== undefined && { type: input.type }),
        ...(input.content !== undefined && { content: input.content }),
      },
    });
    return this.toDto(updated);
  }

  /** 删除（须归属同用户） */
  async remove(userId: string, noteId: string, _actorId: string): Promise<{ id: string }> {
    const row = await this.findOwned(userId, noteId);
    await db.customerNote.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  /** note 必须存在且归属目标用户（E-PROFILE-002） */
  private async findOwned(userId: string, noteId: string) {
    const row = await db.customerNote.findUnique({ where: { id: noteId } });
    if (!row || row.userId !== userId) {
      throw new NotFoundException({ code: 'E-PROFILE-002', message: '标记不存在' });
    }
    return row;
  }

  private async ensureUser(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new NotFoundException({ code: 'E-PROFILE-001', message: '用户不存在' });
    }
  }

  private toDto(row: {
    id: string;
    userId: string;
    type: string;
    content: string;
    createdBy: string;
    createdAt: Date;
  }): CustomerNoteItem {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      content: row.content,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
