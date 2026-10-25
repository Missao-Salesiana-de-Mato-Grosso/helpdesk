import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Sem `globals: true`, o Testing Library não desmonta sozinho entre os testes.
afterEach(() => {
  cleanup();
});

// O Mantine usa matchMedia e ResizeObserver, que o jsdom não implementa.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
window.ResizeObserver = ResizeObserverStub;

// O Combobox do Mantine rola a opção ativa até ficar visível.
Element.prototype.scrollIntoView = vi.fn();
