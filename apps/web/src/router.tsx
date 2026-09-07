import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { CatalogPage, DocsPage, ResourcePage, RootLayout } from './app';

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: CatalogPage,
});

const docsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs',
  component: DocsPage,
});

const resourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$owner/$type/$name',
  component: ResourcePage,
  validateSearch: (search: Record<string, unknown>) => ({
    registry: typeof search.registry === 'string' ? search.registry : undefined,
  }),
});

const routeTree = rootRoute.addChildren([indexRoute, docsRoute, resourceRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
