/** Upload Module — 图片上传（W7-feature + P13 售后图片 client 端点） */
import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { ClientUploadController } from './upload-client.controller';
import { StorageModule } from '../../shared/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [UploadController, ClientUploadController],
})
export class UploadModule {}
