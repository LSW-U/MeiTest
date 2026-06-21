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
  constructor(private schema: ZodSchema) {}

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
          code: 'E-COMMON-001',
          message: 'Validation failed',
          details,
        });
      }
      throw e;
    }
  }
}
