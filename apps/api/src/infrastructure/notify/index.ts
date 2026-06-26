/**
 * Notify infrastructure 出口
 *
 * 4 个策略 + 工厂 + 类型
 */
export { EmailNotifyStrategy } from './email.strategy';
export { SmsNotifyStrategy } from './sms.strategy';
export { PushNotifyStrategy } from './push.strategy';
export { WhatsAppNotifyStrategy } from './whatsapp.strategy';
export { NotifyFactory } from './notify.factory';
export type {
  NotifyChannel,
  NotifyType,
  NotifyRequest,
  NotifyResult,
  NotifyStrategy,
} from './notify-strategy';
