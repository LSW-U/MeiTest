/**
 * Zod 校验 pipe（用 api-contract 的 zod schema 校验请求 body/query/param）
 *
 * 决策依据：契约驱动 + D4-T1 acceptance
 *
 * 用法：
 *   @Post('/login')
 *   async login(@Body(new ZodValidationPipe(LoginRequest)) body: LoginRequestType) {}
 */
import {
  PipeTransform,
  Injectable,
  BadRequestException,
  ArgumentMetadata,
} from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  /**
   * @param schema    契约 Zod schema
   * @param errorCode 可选：校验失败返回的业务错误码（默认 E-COMMON-001）。
   *                  模块级 pipe 可传本模块错误码段（如 warehouse 用 E-WAREHOUSE-004），
   *                  前端按 code 查 errors.json 显示本地化文案。
   */
  constructor(
    private schema: ZodSchema,
    private errorCode: string = 'E-COMMON-001',
  ) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    try {
      return this.schema.parse(value);
    } catch (e: unknown) {
      if (e instanceof ZodError) {
        const details = e.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));
        throw new BadRequestException({
          code: this.errorCode,
          message: 'Validation failed',
          details,
        });
      }
      throw e;
    }
  }
}
