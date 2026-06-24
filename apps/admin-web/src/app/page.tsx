/**
 * 根路由 /
 *
 * - 已登录（localStorage 有 accessToken）：跳当前 perspective 首页
 * - 未登录：跳 /login
 *
 * 这是 server 组件，但 localStorage 只在 client 可用 → 直接 redirect /login，
 * client 端由 PerspectiveGuard 或首页组件自行处理 token 检测。
 *
 * MVP：W1 阶段所有未带 token 的请求都视为未登录，redirect /login。
 *      已登录用户的 / 跳转由 client 端处理（platform page 默认视角 = platform）。
 */
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/login');
}
