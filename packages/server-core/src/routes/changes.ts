import type { RouteContext } from '../types.js';
import { registerInstallRoute } from './install.js';
import { registerUninstallRoute } from './uninstall.js';
import { registerUpdateRoute } from './update.js';

export function registerChangeRoutes(context: RouteContext): void {
  registerInstallRoute(context);
  registerUpdateRoute(context);
  registerUninstallRoute(context);
}
