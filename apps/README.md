# apps/

> 本 repo 的 application 层。

## 当前结构（2026-06-24 更新）

| 目录 | 状态 | 说明 |
|---|---|---|
| `api/` | ✅ 活跃 | NestJS 后端 API |
| `admin-web/` | ✅ 活跃 | Next.js 后台 web（含视角切换器） |
| ~~`client-app/`~~ | 🚚 **已迁出** | 客户端 RN App 迁至 [MeiMart1.0](https://github.com/LSW-U/MeiMart1.0) |
| ~~`rider-app/`~~ | 🚚 **已迁出** | 骑手 RN App 迁至 [MeiMart1.0](https://github.com/LSW-U/MeiMart1.0) |

## 历史

`client-app/` 和 `rider-app/` 是 W1 D2-T6 创建的占位骨架（登录页 UI + i18n 4 语言切换）。
2026-06-24 决策：客户端 + 骑手 App 独立维护在 MeiMart1.0，本 repo 只做后端 + admin-web。

需要参考 W1 时期的代码？用 git：
```bash
git log --oneline --all -- apps/client-app/
git show 6f8683d -- apps/client-app/  # [W1-D2-T6] 三端登录页 commit
```

详见 `CLAUDE.md` §跨 repo 协作 + `W2-COLLABORATION.md` §2.5。
