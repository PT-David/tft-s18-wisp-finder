import { describe, expect, it, vi } from 'vitest';
import { createSearchHighlightController, SEARCH_HIGHLIGHT_NAME } from '../src/ui/searchHighlight';

describe('search highlight progressive enhancement', () => {
  it('is a safe no-op when Custom Highlight API support is injected as false', () => {
    const registry = { delete: vi.fn(() => true), set: vi.fn() };
    const controller = createSearchHighlightController({ supported: false, registry });
    expect(controller.supported).toBe(false);
    expect(() => controller.update([], new Map())).not.toThrow();
    expect(() => controller.clear()).not.toThrow();
    expect(registry.delete).not.toHaveBeenCalledWith(SEARCH_HIGHLIGHT_NAME);
    expect(registry.set).not.toHaveBeenCalled();
  });
});
