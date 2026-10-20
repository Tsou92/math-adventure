/// <reference types="vite/client" />
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import '../app/globals.css';
import Home from '../app/page';

/**
 * 应用题开发预览页只在本机 dev server 的 /word-problems 路由可用。
 * 生产构建中 `import.meta.env.DEV` 恒为 false，整个分支（含动态 import）会被
 * 静态移除，因此正式产物既没有预览入口，也不会打包预览页 chunk，更不涉及
 * 任何登录绕过或数据库依赖。
 */
const root = createRoot(document.getElementById('root')!);
const isWordProblemPreview =
  import.meta.env.DEV && /^\/word-problems\/?$/.test(window.location.pathname);

if (isWordProblemPreview) {
  const WordProblemPreview = lazy(() =>
    import('../components/learning/WordProblemPreview').then((module) => ({
      default: module.WordProblemPreview,
    })),
  );
  root.render(
    <StrictMode>
      <Suspense
        fallback={
          <main className="app-content">
            <p className="muted">正在加载开发预览…</p>
          </main>
        }
      >
        <WordProblemPreview />
      </Suspense>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <Home />
    </StrictMode>,
  );
}
