export function backDecision(route, hasEarlierPage) {
  if (hasEarlierPage) return { action: 'back' };
  const match = /^\/m\/M-(\d{4})-(?:\d{2}|\d{3})$/.exec(route);
  if (match) return { action: 'hash', hash: `#/t/${match[1]}` };
  if (/^\/c\/[A-Z]{3}$/.test(route)) return { action: 'hash', hash: '#/c' };
  if (route === '/k' || route === '/j') return { action: 'hash', hash: '#/' };
  return { action: 'hash', hash: '#/' };
}
