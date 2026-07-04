/**
 * Storage Module — 对象存储封装（dev MinIO / prod 阿里云 OSS）
 *
 * 设计：
 * - MinIO 用 minio npm SDK 直连
 * - env OSS_* 配 endpoint/access/secret/bucket
 * - 对外暴露 StorageService.uploadFile + getPublicUrl
 * - bucket 启动时自动初始化（不存在则创建 + 设 public read policy）
 *
 * 决策依据：CLAUDE.md §外部服务 — dev MinIO / prod 阿里云 OSS，bucket 名 meimart
 */
import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
