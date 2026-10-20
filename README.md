<p align="center">
  <img src="public/og.png" alt="数学星球" width="720">
</p>

<h1 align="center">数学星球</h1>

<p align="center">
  给小学低年级孩子的口算与应用题练习：自由组合题型、应用题分步引导、错题按时复习，家长随时查看进步。
</p>

<p align="center">
  <a href="https://github.com/Tsou92/math-adventure/actions/workflows/ci.yml"><img src="https://github.com/Tsou92/math-adventure/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite 8">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4">
  <img src="https://img.shields.io/badge/Neon-PostgreSQL-00E599?logo=postgresql&logoColor=white" alt="Neon PostgreSQL">
  <img src="https://img.shields.io/badge/Vercel-deployed-000000?logo=vercel&logoColor=white" alt="Vercel">
</p>

## 功能

- 12 种题型自由组合：10 以内到 100 以内的进退位加减、乘法启蒙、表内乘法、乘法后加减、除法启蒙、表内除法、乘除应用题，以及三种珠心算练习，每轮 1～100 道。
- 应用题分步引导：先在题干里点选已知条件；隐藏条件题再单独填写并验证隐藏条件；然后点选所求问题，最后填写数字答案（普通题 3 步，隐藏条件题 4 步）。每一步验证通过才能继续，旧版应用题仍可直接作答。
- 两种练法：轻松练习可以逐题检查、看提示；计时挑战做完后统一批改。
- 答题自动保存，刷新页面或退出后回来可以接着做。
- 答错的题会进入「再挑战」，按间隔安排复习，连续答对才算掌握。
- 家长账号管理孩子账号，随时查看练习记录和成绩。

线上使用 Vercel 静态前端和 Node API，数据库为 Neon PostgreSQL。

## 界面预览

截图中的姓名和练习记录均为虚构的演示数据。

| 孩子首页 | 应用题分步引导 |
| :---: | :---: |
| <img src="docs/screenshots/home.png" alt="孩子首页" width="400"> | <img src="docs/screenshots/practice.png" alt="应用题分步引导" width="400"> |
| **我的进步** | **家长中心** |
| <img src="docs/screenshots/progress.png" alt="我的进步" width="400"> | <img src="docs/screenshots/parent.png" alt="家长中心" width="400"> |

## 本地开发

使用 Node.js 22.13 或更高版本：

```bash
npm ci
npm run dev
```

开发服务器默认只监听 `127.0.0.1`，同源提供页面与 `/api/*`，API 复用线上 `server/router.ts`。匿名访问 `/api/auth/me` 应返回 `200 {"user":null}`，不需要数据库。登录与答题需要在未提交的 `.env.local` 中设置开发数据库的 `DATABASE_URL`；Vite 只将该配置提供给服务端，不暴露给浏览器。不要使用生产数据库进行开发。

本地开发还提供一个免登录的应用题预览页 `http://127.0.0.1:5173/word-problems`（仅 `vite dev` 的 DEV 构建可用，不连接数据库或账号），复用正式题目生成器与答题组件，展示三道原始示例和一组随机新题，方便核对题干、条件/隐藏条件/问题点选、隐藏条件语义校验与最终答案（隐藏条件题可看到「条件 → 隐藏条件 → 问题 → 答案」的 4 步顺序）。生产构建不会暴露该入口，也不提供任何登录绕过。

首次配置专用开发数据库后，可运行 `npm run db:migrate` 应用 `db/migrations/`。`npm run db:bootstrap` 是初始化家长账号的维护命令。现有 004/005 迁移分别提供学习模式/错题复习与混合乘法字段；合并部署保留这两项已上线迁移，可靠性修复本身不新增表结构。

`npm run dev:vinext` 保留原 vinext 开发入口，也接入同一份 Node API 适配器。Vercel 部署继续使用 `npm run build:vercel`；`npm run build` 保留原 vinext/Cloudflare 构建检查。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run build:vercel
```

浏览器回归测试覆盖保存冲突、放弃失败、退出登录前保存与操作锁定、成绩刷新重试，以及乘除应用题的条件/隐藏条件/问题点选、隐藏条件分步校验与草稿恢复、刷新与单题/整页切换恢复、父级答案被云端答案外部更新或清空时末步输入框同步。测试拦截 API，使用独立端口启动本地页面，不会向数据库写入：

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
- `lib/word-problems.ts`：新版乘除应用题的出题、隐藏条件语义校验与分步草稿存储。
- `lib/answer-save.ts`：与 React 解耦的保存队列、版本冲突和重试逻辑。
- `lib/api-client.ts`：请求超时、取消与错误解析。
- `server/router.ts`：HTTP 路由、参数校验和权限入口。
- `server/round-service.ts`：轮次事务、批量保存与交卷。
- `server/db.ts`：Neon HTTP 查询和请求内的事务连接。
- `server/dev-api.ts`：本地 Node 请求与 Vercel handler 的适配。

保存、开始、交卷、放弃都会锁定同一轮次，再读取状态与答案。已完成轮次的重复交卷返回原成绩；同一出题意图复用幂等键。修改密码在事务中撤销旧会话并生成新会话，恢复码改密也先锁定账号再撤销会话，提交成功后才设置 Cookie；创建登录会话时锁定账号并复核密码哈希，避免旧密码验证请求在改密后生成会话。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
