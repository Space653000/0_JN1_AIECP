'use strict';

// Loads the real ui/*.js scripts into a vm context with a permissive fake DOM. There is no jsdom in this project,
// so the fake records what the UI does: every window.aecp call, confirm() prompt, event listener and innerHTML write.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UI = path.resolve(__dirname, '..', '..', 'ui');

function makeElement(selector, doc) {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  let explicitValue = null;
  const el = {
    selector, dataset: {}, style: {}, children: [], textContent: '', checked: false, disabled: false, title: '', hidden: false, tabIndex: 0,
    innerHTML: '', innerText: '', open: false,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, force) => { const on = force === undefined ? !classes.has(name) : Boolean(force); if (on) classes.add(name); else classes.delete(name); return on; },
      contains: (name) => classes.has(name)
    },
    // A <select> shows its first option until something else is chosen, exactly like the real DOM.
    get value() { if (explicitValue !== null) return explicitValue; return /select/i.test(selector) ? (/<option value="([^"]*)"/.exec(el.innerHTML)?.[1] ?? '') : ''; },
    set value(next) { explicitValue = String(next); },
    get className() { return [...classes].join(' '); },
    set className(value) { classes.clear(); String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
    setAttribute: (key, value) => { attrs[key] = String(value); },
    getAttribute: (key) => (key in attrs ? attrs[key] : null),
    removeAttribute: (key) => { delete attrs[key]; },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: () => {},
    listeners,
    async fire(type, event = {}) { for (const fn of listeners[type] || []) await fn({ target: el, preventDefault() {}, ...event }); },
    click() { return el.fire('click'); },
    appendChild: (child) => { el.children.push(child); return child; },
    append: (...items) => { el.children.push(...items); },
    remove: () => {}, focus: () => {}, blur: () => {}, reset: () => {}, scrollIntoView: () => {}, showModal: () => {}, close: () => {},
    closest: () => null,
    querySelector: (sel) => doc.querySelector(sel),
    querySelectorAll: (sel) => doc.querySelectorAll(sel)
  };
  return el;
}

function createUi({ responses = {}, confirmAnswer = true, storage = {}, extraScripts = [], files = ['i18n.js', 'theme.js', 'app.js'] } = {}) {
  const calls = [];
  const prompts = [];
  const elements = new Map();
  const docListeners = {};
  const doc = {
    listeners: docListeners,
    body: null, documentElement: null,
    querySelector(sel) { if (!elements.has(sel)) elements.set(sel, makeElement(sel, doc)); return elements.get(sel); },
    querySelectorAll(sel) { return (doc.lists?.[sel] || []); },
    createElement(tag) { return makeElement(`<${tag}>`, doc); },
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    removeEventListener() {},
    lists: {}
  };
  doc.body = makeElement('body', doc);
  doc.documentElement = makeElement('html', doc);
  const pending = [];
  const callbacks = {};
  const aecp = new Proxy({}, {
    get: (_target, name) => {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (/^on[A-Z]/.test(name)) return (fn) => { (callbacks[name] ||= []).push(fn); };
      return (...args) => {
        calls.push({ name, args });
        const answer = responses[name];
        const value = typeof answer === 'function' ? answer(...args) : answer;
        const promise = Promise.resolve(value === undefined ? null : value);
        pending.push(promise);
        return promise;
      };
    }
  });
  const memory = new Map(Object.entries(storage));
  const localStorage = { getItem: (key) => (memory.has(key) ? memory.get(key) : null), setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key) };
  const sandbox = {
    document: doc, localStorage, console,
    confirm: (message) => { prompts.push(String(message)); return typeof confirmAnswer === 'function' ? confirmAnswer(message) : confirmAnswer; },
    alert: (message) => { prompts.push(String(message)); },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
    clearTimeout, clearInterval,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    Intl, aecp
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of [...files, ...extraScripts]) vm.runInContext(fs.readFileSync(path.join(UI, file), 'utf8'), context, { filename: path.join(UI, file) });

  async function settle(rounds = 8) {
    for (let i = 0; i < rounds; i++) {
      const snapshot = pending.splice(0);
      await Promise.all(snapshot);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return {
    context, document: doc, calls, prompts, callbacks, settle,
    el: (sel) => doc.querySelector(sel),
    evaluate: (code) => vm.runInContext(code, context),
    emit: async (name, event) => { for (const fn of callbacks[name] || []) await fn(event); }
  };
}

module.exports = { createUi, makeElement };
