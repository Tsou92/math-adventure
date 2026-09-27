# 口算星球

儿童数学练习应用，包含家长与孩子账号、自选题目、算盘练习、自动保存、成绩与错题本。线上使用 Vercel 静态前端和 Node API，数据库为 Neon PostgreSQL。

## 本地开发

使用 Node.js 22.13 或更高版本：

```bash
npm ci
npm run dev
```

开发服务器默认只监听 `127.0.0.1`，同源提供页面与 `/api/*`，API 复用线上 `server/router.ts`。匿名访问 `/api/auth/me` 应返回 `200 {"user":null}`，不需要数据库。登录与答题需要在未提交的 `.env.local` 中设置开发数据库的 `DATABASE_URL`；Vite 只将该配置提供给服务端，不暴露给浏览器。不要使用生产数据库进行开发。

首次配置专用开发数据库后，可运行 `npm run db:migrate` 应用 `db/migrations/`。`npm run db:bootstrap` 是初始化家长账号的维护命令。此次可靠性修复不引入新迁移。

`npm run dev:vinext` 保留原 vinext 开发入口，也接入同一份 Node API 适配器。Vercel 部署继续使用 `npm run build:vercel`；`npm run build` 保留原 vinext/Cloudflare 构建检查。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run build:vercel
```

浏览器回归测试覆盖保存冲突、放弃失败、退出登录前保存与操作锁定、成绩刷新重试。测试拦截 API，使用独立端口启动本地页面，不会向数据库写入：

```bash
npx playwright install chromium
npm run test:e2e
```

默认测试不读取 `.env.local`，不连接真实数据库。GitHub Actions 执行以上检查，并使用独立 PostgreSQL 服务运行集成测试。

集成测试需要显式 `TEST_DATABASE_URL`，数据库名称必须以 `_test` 结尾。测试会在这个专用数据库应用迁移、创建临时测试账号和练习，结束后删除自己创建的数据；禁止指向业务数据库。

```bash
TEST_DATABASE_URL='postgres://postgres:password@127.0.0.1:5432/math_adventure_test' npm run test:integration
```

集成测试通过标准 PostgreSQL 驱动替换 Neon 网络传输，执行真实业务 SQL 和并发事务，覆盖重复交卷、保存与交卷竞争、批量冲突回滚、重练重试、密码会话轮换与改密期间的登录竞争。它不替代 Neon WebSocket 连接的部署环境冒烟验证。

## 代码组织

- `app/page.tsx`：登录状态入口。
- `components/learning/`：家长管理、练习、历史、错题本等界面。
- `lib/answer-save.ts`：与 React 解耦的保存队列、版本冲突和重试逻辑。
- `lib/api-client.ts`：请求超时、取消与错误解析。
- `server/router.ts`：HTTP 路由、参数校验和权限入口。
- `server/round-service.ts`：轮次事务、批量保存与交卷。
- `server/db.ts`：Neon HTTP 查询和请求内的事务连接。
- `server/dev-api.ts`：本地 Node 请求与 Vercel handler 的适配。

保存、开始、交卷、放弃都会锁定同一轮次，再读取状态与答案。已完成轮次的重复交卷返回原成绩；同一出题意图复用幂等键。修改密码在事务中撤销旧会话并生成新会话，提交成功后才设置 Cookie；创建登录会话时锁定账号并复核密码哈希，避免旧密码验证请求在改密后生成会话。
