/**
 * 用户资料模块 schema
 *
 * 决策依据：
 * - 契约 v0.2 §5.1 User 字段基准
 * - 契约 v0.3 决策 C：role 用 5 个真实角色（小写 snake_case）
 * - CLAUDE.md §多语言：name 等用 i18n，但 User.name 是昵称（单值），不进多语言
 */
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';
import { Role } from './auth';

export const UserStatus = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']);

/** 用户实体（API 响应基准；phone 脱敏返回，例：770****234） */
export const User = z.object({
  id: Id,
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: Role,
  status: UserStatus,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 修改个人资料请求 */
export const UpdateProfileRequest = z.object({
  name: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
});

/** 修改密码请求 */
export const ChangePasswordRequest = z.object({
  oldPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/[a-zA-Z]/)
    .regex(/\d/),
});
