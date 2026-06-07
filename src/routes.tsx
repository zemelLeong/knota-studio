import { type ComponentType, lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PageLoader } from '@/components/PageLoader';
import MainLayout from '@/layout/MainLayout';
import LoginPage from '@/pages/login';

/** Wrap a lazy-loaded page component with ErrorBoundary + Suspense fallback. */
function lazyRoute(
  importer: () => Promise<{ default: ComponentType<unknown> }>,
): React.ReactNode {
  const LazyPage = lazy(importer);
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <LazyPage />
      </Suspense>
    </ErrorBoundary>
  );
}

const ComingSoonPage = () => (
  <div className="flex h-full items-center justify-center">
    <div className="text-center">
      <h1 className="text-2xl font-semibold">页面开发中</h1>
      <p className="mt-2 text-muted-foreground">该功能正在迁移中，敬请期待</p>
    </div>
  </div>
);

const routes: RouteObject[] = [
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/api-keys/exchange',
    element: lazyRoute(() => import('@/pages/exchange')),
  },
  {
    element: (
      <ErrorBoundary>
        <AuthGuard />
      </ErrorBoundary>
    ),
    children: [
      {
        element: (
          <ErrorBoundary>
            <MainLayout />
          </ErrorBoundary>
        ),
        children: [
          {
            path: '/',
            element: lazyRoute(() => import('@/pages/dashboard')),
          },
          {
            path: '/system/users',
            element: lazyRoute(() => import('@/pages/system/users')),
          },
          {
            path: '/system/roles',
            element: lazyRoute(() => import('@/pages/system/roles')),
          },
          {
            path: '/system/tenants',
            element: lazyRoute(() => import('@/pages/system/tenants')),
          },
          {
            path: '/system/sys-menus',
            element: lazyRoute(() => import('@/pages/system/sys-menus')),
          },
          {
            path: '/system/menus',
            element: lazyRoute(() => import('@/pages/system/menus')),
          },
          {
            path: '/system/permissions',
            element: lazyRoute(() => import('@/pages/system/permissions')),
          },
          {
            path: '/system/role-templates',
            element: lazyRoute(() => import('@/pages/system/role-templates')),
          },
          {
            path: '/system/dicts',
            element: lazyRoute(() => import('@/pages/system/dicts')),
          },
          {
            path: '/system/sys-configs',
            element: lazyRoute(() => import('@/pages/system/sys-configs')),
          },
          {
            path: '/profile',
            element: lazyRoute(() => import('@/pages/profile')),
          },
          {
            path: '/system/i18n',
            element: lazyRoute(() => import('@/pages/system/i18n')),
          },
          {
            path: '/system/audit-logs',
            element: lazyRoute(() => import('@/pages/system/audit-logs')),
          },
          {
            path: '/system/app-logs',
            element: lazyRoute(() => import('@/pages/system/app-logs')),
          },
          {
            path: '/system/notifications',
            element: lazyRoute(() => import('@/pages/system/notifications')),
          },
          {
            path: '/system/api-keys',
            element: lazyRoute(() => import('@/pages/system/api-keys')),
          },
          {
            path: '/system/scheduler',
            element: lazyRoute(() => import('@/pages/system/scheduler')),
          },
          {
            path: '/system/files',
            element: lazyRoute(() => import('@/pages/system/files')),
          },
          {
            path: '/knowledge-base',
            element: lazyRoute(() => import('@/pages/knowledge-base')),
          },
          {
            path: '/test/datetime',
            element: lazyRoute(() => import('@/pages/test/datetime')),
          },
          {
            path: '*',
            element: <ComingSoonPage />,
          },
        ],
      },
    ],
  },
];

export default routes;
