import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, vi } from 'vitest';

vi.stubGlobal('crypto', webcrypto);
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/'); });
afterEach(() => vi.restoreAllMocks());
