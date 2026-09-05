import type { ToolPackageManager } from '@ai-directory/contracts';

export type PackageManagerDefinition = {
  command: string;
  installArgs(packageName: string): string[];
  upgradeArgs(packageName: string): string[];
  uninstallArgs(packageName: string): string[];
};

const packageManagers = {
  homebrew: {
    command: 'brew',
    installArgs: (packageName) => ['install', packageName],
    upgradeArgs: (packageName) => ['upgrade', packageName],
    uninstallArgs: (packageName) => ['uninstall', packageName],
  },
  pipx: {
    command: 'pipx',
    installArgs: (packageName) => ['install', packageName],
    upgradeArgs: (packageName) => ['upgrade', packageName],
    uninstallArgs: (packageName) => ['uninstall', packageName],
  },
  npm: {
    command: 'npm',
    installArgs: (packageName) => ['install', '--global', packageName],
    upgradeArgs: (packageName) => ['install', '--global', packageName],
    uninstallArgs: (packageName) => ['uninstall', '--global', packageName],
  },
  cargo: {
    command: 'cargo',
    installArgs: (packageName) => ['install', packageName],
    upgradeArgs: (packageName) => ['install', packageName],
    uninstallArgs: (packageName) => ['uninstall', packageName],
  },
} satisfies Record<ToolPackageManager, PackageManagerDefinition>;

export function packageManagerDefinition(manager: ToolPackageManager): PackageManagerDefinition {
  return packageManagers[manager];
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}
