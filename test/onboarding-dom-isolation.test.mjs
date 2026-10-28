import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOnboardingSource } from "./helpers/onboarding-harness.mjs";

const { isolateOnboardingDom } = loadOnboardingSource("src/lib/onboarding/dom-isolation.ts");

test("DOM isolation protects existing/new operational portals and restores original state", () => {
  const originalElement = globalThis.HTMLElement,
    originalObserver = globalThis.MutationObserver;
  class Element extends EventTarget {
    inert = false;
    attributes = new Map();
    children = [];
    isConnected = true;
    constructor(document) {
      super();
      this.ownerDocument = document;
    }
    contains(element) {
      return this.children.includes(element);
    }
    getAttribute(key) {
      return this.attributes.get(key) ?? null;
    }
    setAttribute(key, value) {
      this.attributes.set(key, value);
    }
    removeAttribute(key) {
      this.attributes.delete(key);
    }
    focus() {
      this.ownerDocument.activeElement = this;
    }
    querySelectorAll() {
      return this.children;
    }
    closest() {
      return null;
    }
    getClientRects() {
      return [{}];
    }
  }
  let notify,
    disconnected = false;
  globalThis.HTMLElement = Element;
  globalThis.MutationObserver = class {
    constructor(callback) {
      notify = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  try {
    const document = new EventTarget();
    document.body = new Element(document);
    const operation = new Element(document),
      existingPortal = new Element(document),
      root = new Element(document);
    existingPortal.inert = true;
    existingPortal.setAttribute("aria-hidden", "false");
    document.body.children = [operation, existingPortal, root];
    document.activeElement = operation;
    const restore = isolateOnboardingDom(root);
    assert.equal(operation.inert, true);
    assert.equal(operation.getAttribute("aria-hidden"), "true");
    assert.equal(document.activeElement, root);
    for (const type of ["click", "submit", "input", "change", "keydown", "drop"]) {
      const event = new Event(type, { cancelable: true });
      event.composedPath = () => [operation, document.body, document];
      document.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, type);
      const inside = new Event(type, { cancelable: true });
      inside.composedPath = () => [root, document.body, document];
      document.dispatchEvent(inside);
      assert.equal(inside.defaultPrevented, false, `demo ${type}`);
    }
    const newPortal = new Element(document);
    document.body.children.push(newPortal);
    notify();
    assert.equal(newPortal.inert, true);
    assert.equal(newPortal.getAttribute("aria-hidden"), "true");
    restore();
    assert.equal(disconnected, true);
    assert.equal(operation.inert, false);
    assert.equal(operation.getAttribute("aria-hidden"), null);
    assert.equal(existingPortal.inert, true);
    assert.equal(existingPortal.getAttribute("aria-hidden"), "false");
    assert.equal(newPortal.inert, false);
    assert.equal(newPortal.getAttribute("aria-hidden"), null);
    assert.equal(document.activeElement, operation);
    const event = new Event("click", { cancelable: true });
    document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  } finally {
    globalThis.HTMLElement = originalElement;
    globalThis.MutationObserver = originalObserver;
  }
});
