import { rubyPlain } from './ruby.js?v=0.5.3';

const ALLOWED_ATTRIBUTES = new Set([
  'alt', 'aria-current', 'aria-hidden', 'aria-label', 'aria-live', 'aria-pressed', 'class', 'colspan', 'href', 'id',
  'role', 'scope', 'src', 'title', 'type', 'width', 'height', 'for', 'placeholder',
  'enterkeyhint', 'autocomplete', 'autocorrect', 'autocapitalize', 'spellcheck', 'loading', 'value', 'selected',
  'data-year',
]);

const APPROVED_HTTPS_HOSTS = new Set([
  'github.com', 'creativecommons.org', 'commons.wikimedia.org',
]);

function validHref(value) {
  if (value.startsWith('#/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && APPROVED_HTTPS_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function text(value) {
  return document.createTextNode(String(value));
}

export function rubyNodes(markup) {
  // Readings are intentionally not displayed.
  return text(rubyPlain(markup));
}

export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(name)) throw new Error(`attribute not allowed: ${name}`);
    if (value !== null && value !== undefined && value !== false) {
      const serialized = value === true ? '' : String(value);
      if (name === 'href' && !validHref(serialized)) throw new Error(`href not allowed: ${serialized}`);
      node.setAttribute(name, serialized);
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : text(child));
  }
  return node;
}

export function rubyEl(tag, markup, attributes = {}) {
  return el(tag, attributes, rubyNodes(markup));
}

export function replace(node, children) {
  node.replaceChildren(...(Array.isArray(children) ? children.flat(Infinity) : [children]));
}
