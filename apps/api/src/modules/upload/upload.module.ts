/** Upload Module — 图片上传（W7-feature） */
import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { StorageModule } from '../../shared/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [UploadController],
})
export class UploadModule {}
