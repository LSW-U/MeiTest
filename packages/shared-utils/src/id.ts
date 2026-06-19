/**
 * ID 生成器：UUID v7（时序友好，PostgreSQL 索引性能好）
 *
 * 决策依据：契约 v0.2 §1.3 — ID 用 UUID v4，但 v7 时序友好适合数据库索引
 */
import { v4 as uuidv4, v7 as uuidv7, validate as uuidValidate } from 'uuid';

/** 生成 UUID v7（推荐用于 DB 主键） */
export function genId(): string {
  return uuidv7();
}

/** 生成 UUID v4（兼容旧契约场景） */
export function genIdV4(): string {
  return uuidv4();
}

/** 校验是否为合法 UUID（任意版本） */
export function isValidUuid(s: string): boolean {
  return uuidValidate(s);
}
