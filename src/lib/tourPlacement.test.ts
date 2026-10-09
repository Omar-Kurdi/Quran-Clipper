import { describe, expect, it } from 'vitest';
import { phoneCardPosition } from './tourPlacement';

const phone = { width: 375, height: 640 };
const tab = { top: 590, left: 0, width: 125, height: 44 };

describe('phoneCardPosition', () => {
  it('puts the card above the panel a step describes when it fits there', () => {
    // The Captions panel, under the preview pinned at the top.
    const panel = { top: 290, left: 0, width: 375, height: 200 };
    const at = phoneCardPosition(panel, tab, 160, phone);
    expect(at.top).toBeDefined();
    expect(at.top! + 160).toBeLessThanOrEqual(panel.top);
  });

  it('puts it below the panel when only that side has room', () => {
    const panel = { top: 60, left: 0, width: 375, height: 300 };
    const at = phoneCardPosition(panel, tab, 160, phone);
    expect(at.top).toBeGreaterThanOrEqual(panel.top + panel.height);
    expect(at.top! + 160).toBeLessThanOrEqual(tab.top);
  });

  it('falls back to just above the tab bar when the panel fills the screen', () => {
    // The Source form, with no preview above it.
    const panel = { top: 56, left: 0, width: 375, height: 520 };
    const at = phoneCardPosition(panel, tab, 160, phone);
    expect(at.top).toBeUndefined();
    expect(phone.height - at.bottom!).toBeLessThan(tab.top);
  });

  it('spans the screen with a 12px margin', () => {
    const at = phoneCardPosition(null, tab, 160, phone);
    expect(at).toMatchObject({ left: 12, width: 351 });
  });
});
