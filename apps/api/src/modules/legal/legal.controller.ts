/**
 * Legal Controller — 法律文档公开下发（P5 #3，2026-08-25）
 *
 * 路径：
 *   GET  /api/v1/common/legal/:docType   公开（注册/协议页读，无需登录）
 *     docType: TERMS（服务条款）/ PRIVACY（隐私政策）
 *
 * 决策依据：
 *   - @Public：未登录可读（注册页/首次启动协议页都要展示）
 *   - common 前缀 → DeviceTypeGuard 不限制 deviceType
 *   - Accept-Language → 单语言正文切片（fallback 链 lang → en → ""）
 *
 * 错误码：docType 非法 / 未 seed → E-LEGAL-001
 */
import { Controller, Get, Headers, Param } from '@nestjs/common';
import { LegalService } from './legal.service';
import { Public } from '../../shared/decorators/public.decorator';

@Controller('api/v1/common/legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /** 公开获取法律文档（TERMS / PRIVACY）当前生效版本，按语言切片 */
  @Public()
  @Get(':docType')
  async getDoc(
    @Param('docType') docType: string,
    @Headers('accept-language') acceptLang?: string,
  ) {
    const data = await this.legal.getActiveDoc(docType, acceptLang);
    return { success: true, data };
  }
}
