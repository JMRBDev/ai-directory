import { isAbsolute, relative, resolve, sep } from 'node:path';

export function isPathWithin(path: string, root: string): boolean {
  const pathRelativeToRoot = relative(root, path);
  return pathRelativeToRoot === ''
    || (!isAbsolute(pathRelativeToRoot)
      && pathRelativeToRoot !== '..'
      && !pathRelativeToRoot.startsWith('..' + sep));
}

export function pathsOverlap(left: string, right: string): boolean {
  const first = resolve(left);
  const second = resolve(right);
  return isPathWithin(first, second) || isPathWithin(second, first);
}

export function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}
