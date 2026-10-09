// Kleine hulpfuncties voor de interface. Alle tekst gaat via textContent,
// nooit via innerHTML, zodat namen van gasten geen code kunnen worden.

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

export function icon(id) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svgNs, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

let toastTimer;
export function toast(message) {
  const node = document.getElementById('toast') || document.body.appendChild(el('div', { id: 'toast', class: 'toast', role: 'status' }));
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2600);
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Fout ${res.status}`), { status: res.status });
  return data;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Terugval voor browsers zonder klembordtoegang.
    const area = el('textarea', { readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

// Opslag in de browser alleen voor gemak (naam, bubbelpositie). Mag altijd ontbreken.
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`wowround:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`wowround:${key}`, JSON.stringify(value));
    } catch {
      /* geen opslag beschikbaar: prima */
    }
  },
};

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
