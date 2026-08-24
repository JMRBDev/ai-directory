import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { CatalogPage, ResourcePage, RootLayout } from './app';

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: CatalogPage,
});

const resourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resources/$owner/$type/$name',
  component: ResourcePage,
});

const routeTree = rootRoute.addChildren([indexRoute, resourceRoute]);

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
