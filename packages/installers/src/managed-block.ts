export function ruleBlockMarkers(key: string): { start: string; end: string } {
  return {
    start: `<!-- ai-directory:rule:${key} -->`,
    end: `<!-- /ai-directory:rule:${key} -->`,
  };
}

export function ruleBlock(key: string, body: string): string {
  const { start, end } = ruleBlockMarkers(key);
  const normalized = body.endsWith('\n') ? body : `${body}\n`;
  return [start, normalized, end].join('\n');
}

export function upsertMarkedBlock(
  contents: string,
  key: string,
  block: string,
  force: boolean,
  alreadyInstalledError: string,
  malformedError: string,
): string {
  const { start, end } = ruleBlockMarkers(key);
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end);

  if ((startIndex === -1) !== (endIndex === -1) || (startIndex !== -1 && endIndex < startIndex)) {
    throw new Error(`${malformedError}: ${key}`);
  }

  if (startIndex !== -1 && endIndex !== -1) {
    if (!force) {
      throw new Error(`${alreadyInstalledError}: ${key}. Use --force to overwrite.`);
    }

    return `${contents.slice(0, startIndex)}${block}${contents.slice(endIndex + end.length)}`;
  }

  const separator = contents.length === 0
    ? ''
    : contents.endsWith('\n')
      ? '\n'
      : '\n\n';

  return `${contents}${separator}${block}\n`;
}

export function removeMarkedBlock(
  contents: string,
  key: string,
  malformedError: string,
): { content: string; removed: boolean } {
  const { start, end } = ruleBlockMarkers(key);
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end);

  if (startIndex === -1 && endIndex === -1) return { content: contents, removed: false };

  if ((startIndex === -1) !== (endIndex === -1) || endIndex < startIndex) {
    throw new Error(`${malformedError}: ${key}`);
  }

  const before = contents.slice(0, startIndex);
  const after = contents.slice(endIndex + end.length);
  const cleanedBefore = before.endsWith('\n\n') ? before.slice(0, -1) : before;
  const cleanedAfter = after.startsWith('\n') ? after.slice(1) : after;
  return { content: `${cleanedBefore}${cleanedAfter}`, removed: true };
}
