/**
 * 无言以队 · 本地存储桥（localStorage 优先，file:// 下自动降级为内存存储）
 * 与浏览器端 web/lib/storage 行为一致，供 Node 测试复用。
 */
'use strict';

function createMemoryStore() {
  const map = new Map();
  return {
    kind: 'memory',
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    keys() { return Array.from(map.keys()); }
  };
}

function createStore(shared) {
  const mem = createMemoryStore();
  let ls = null;
  try {
    const g = shared || (typeof globalThis !== 'undefined' ? globalThis : null);
    if (g && g.localStorage) {
      const probe = '__wuyan_probe__';
      g.localStorage.setItem(probe, '1');
      g.localStorage.removeItem(probe);
      ls = g.localStorage;
    }
  } catch (e) {
    ls = null;
  }
  if (!ls) return mem;
  return {
    kind: 'localStorage',
    getItem: (k) => ls.getItem(k),
    setItem: (k, v) => ls.setItem(k, v),
    removeItem: (k) => ls.removeItem(k),
    clear: () => ls.clear(),
    keys: () => Object.keys(ls)
  };
}

module.exports = { createStore, createMemoryStore };
