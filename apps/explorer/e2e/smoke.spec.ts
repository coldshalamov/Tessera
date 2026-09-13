import { expect, test } from '@playwright/test';
import { buildStemsDemo } from '../src/demo/stems.js';

/**
 * Real-browser smoke for the explorer (packet T06): the demo path, version
 * re-denomination on click, keyboard tree navigation, honest labels, a file
 * load, 320px layout and reduced motion. Assertions target visible text and
 * ARIA roles — the same contract the component tests prove in jsdom.
 */

const DEMO_BUTTON = 'Load the music-stems demo';

async function loadDemo(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.mode-badge')).toContainText('NO DATA');
  await page.getByRole('button', { name: DEMO_BUTTON }).click();
  // Real Ed25519/SHA-256 work happens in-page; wait for the verified state.
  await expect(page.getByText(/VALID — OFFLINE CHECKS ONLY/)).toBeVisible({ timeout: 60_000 });
}

test('demo loads with honest labels and exact payout table', async ({ page }) => {
  await loadDemo(page);
  await expect(page.locator('.mode-badge')).toContainText('LOCAL DEMO');
  await expect(page.getByRole('treeitem')).toHaveCount(5);
  // Chain context + exact denominator at the bundle leaf (571.6e9 issued).
  await expect(page.getByText('network genesis hash')).toBeVisible();
  await expect(page.locator('caption').first()).toContainText('571,600,000,000 units');
  // Chain finality is an explicit warn, never a green claim.
  await expect(page.locator('li.check', { hasText: 'chain.finality' })).toContainText('WARN');
  // Banned claims never appear.
  const body = await page.locator('body').innerText();
  for (const banned of [/copyright verified/i, /court-proof/i, /permanent forever/i, /\bpaid\b/i]) {
    expect(body).not.toMatch(banned);
  }
});

test('clicking a nested treeitem selects THAT version and re-denominates', async ({ page }) => {
  await loadDemo(page);
  // Bass stem is nested inside the root's group: a bubbling bug here once
  // selected the root instead — this is the real-browser regression check.
  await page.getByRole('treeitem', { name: /Bass stem/ }).click();
  await expect(page.locator('caption').first()).toContainText('400,000,000,000 units');
  await expect(page.getByRole('treeitem', { name: /Bass stem/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#node=[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test('keyboard reaches every node without pointer input', async ({ page }) => {
  await loadDemo(page);
  const items = page.getByRole('treeitem');
  await items.first().focus();
  // Walk all five with ArrowDown, then select with Enter.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  const bass = page.getByRole('treeitem', { name: /Bass stem/ });
  await expect(bass).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bass).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('caption').first()).toContainText('400,000,000,000 units');
});

test('bundle file input loads via the real file picker path', async ({ page }) => {
  await page.goto('/');
  // Build the same demo bundle in the test runner (identical code path —
  // the app source is shared, the packages resolve to their built dist),
  // then feed the bytes back through the file input like a downloaded
  // artifact would be.
  const demo = await buildStemsDemo();
  await page.getByLabel('Choose an evidence bundle file').setInputFiles({
    name: 'roundtrip.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(demo.zipBytes),
  });
  await expect(page.locator('.mode-badge')).toContainText('OFFLINE BUNDLE');
  await expect(page.getByRole('treeitem')).toHaveCount(5);
});

test('320px viewport: content is readable without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await loadDemo(page);
  const scroll = await page.evaluate(() => {
    window.scrollTo(500, 0);
    return {
      scrollX: window.scrollX,
      docWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  // The page must not be horizontally scrollable at 320px.
  expect(scroll.scrollX).toBe(0);
  expect(scroll.docWidth).toBeLessThanOrEqual(320);
  // The payout table still exposes its content (in its own scroll region).
  await expect(page.locator('caption').first()).toContainText('571,600,000,000 units');
  await page.screenshot({ path: 'e2e/artifacts/explorer-320px.png', fullPage: true });
});

test('reduced-motion emulation keeps the app fully functional', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadDemo(page);
  await expect(page.getByRole('treeitem')).toHaveCount(5);
  // Aim at the node's own row: the treeitem <li> box spans its expanded
  // children, so a bare locator click lands mid-box on a descendant row
  // (correctly selecting that descendant — verified separately).
  await page.getByRole('treeitem', { name: /Drum stem/ }).locator('> .tree-row').click();
  await expect(page.locator('caption').first()).toContainText('440,000,000,000 units');
});

test('desktop screenshot for QA evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadDemo(page);
  await page.screenshot({ path: 'e2e/artifacts/explorer-desktop.png', fullPage: true });
});
