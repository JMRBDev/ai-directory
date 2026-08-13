import { useEffect } from 'preact/hooks';

export function useMountEffect(effect: () => void | (() => void)) {
  useEffect(effect, []);
}
