import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, '..', 'screenshots');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function waitForApp(page) {
  // Wait for the dashboard to be fully rendered
  await page.waitForSelector('header', { timeout: 15000 });
  // Wait for panels to render
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  // ──────────────────────────────────────────────
  // 1. Light mode — full dashboard
  // ──────────────────────────────────────────────
  console.log('📸 Light mode dashboard...');
  await page.goto(`${BASE_URL}?demo=true`);
  await waitForApp(page);
  // Force light theme
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.documentElement.style.colorScheme = 'light';
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'lightmode.png'), fullPage: false });

  // ──────────────────────────────────────────────
  // 2. Dark mode — full dashboard
  // ──────────────────────────────────────────────
  console.log('📸 Dark mode dashboard...');
  await page.evaluate(() => {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotsDir, 'darkmode.png'), fullPage: false });

  // ──────────────────────────────────────────────
  // 3. Work Log — preview mode
  // ──────────────────────────────────────────────
  console.log('📸 Work log preview mode...');
  // Switch back to light for feature screenshots
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.documentElement.style.colorScheme = 'light';
  });
  await page.waitForTimeout(300);
  // Click "Preview" button in the work log panel
  const previewBtn = page.locator('button:has-text("Preview")');
  if (await previewBtn.count() > 0) {
    await previewBtn.first().click();
    await page.waitForTimeout(500);
  }
  // Screenshot just the work log panel (first panel card)
  const workLogPanel = page.locator('.group\\/card').first();
  await workLogPanel.screenshot({ path: path.join(screenshotsDir, 'worklog-preview.png') });

  // Switch back to edit mode 
  const editBtn = page.locator('button:has-text("Edit")');
  if (await editBtn.count() > 0) {
    await editBtn.first().click();
    await page.waitForTimeout(300);
  }

  // ──────────────────────────────────────────────
  // 4. Linkify feature
  // ──────────────────────────────────────────────
  console.log('📸 Linkify...');
  const linkifyBtn = page.locator('button:has-text("Linkify")');
  if (await linkifyBtn.count() > 0) {
    await linkifyBtn.first().click();
    // Wait for demo linkify to complete
    await page.waitForTimeout(2000);
  }
  // Switch to preview to show the linked content
  const previewBtn2 = page.locator('button:has-text("Preview")');
  if (await previewBtn2.count() > 0) {
    await previewBtn2.first().click();
    await page.waitForTimeout(500);
  }
  const workLogAfterLinkify = page.locator('.group\\/card').first();
  await workLogAfterLinkify.screenshot({ path: path.join(screenshotsDir, 'linkify.png') });

  // Switch back to edit
  const editBtn2 = page.locator('button:has-text("Edit")');
  if (await editBtn2.count() > 0) {
    await editBtn2.first().click();
    await page.waitForTimeout(300);
  }

  // ──────────────────────────────────────────────
  // 5. TODO list panel
  // ──────────────────────────────────────────────
  console.log('📸 TODO list...');
  // The TODO panel is the second group/card in the left column
  const todoPanel = page.locator('.group\\/card').nth(1);
  await todoPanel.screenshot({ path: path.join(screenshotsDir, 'todos.png') });

  // ──────────────────────────────────────────────
  // 6. AI-suggested TODOs
  // ──────────────────────────────────────────────
  console.log('📸 AI-suggested TODOs...');
  const suggestBtn = page.locator('button:has-text("Suggest")');
  if (await suggestBtn.count() > 0) {
    await suggestBtn.first().click();
    await page.waitForTimeout(2000);
  }
  await todoPanel.screenshot({ path: path.join(screenshotsDir, 'ai-todos.png') });

  // ──────────────────────────────────────────────
  // 7. My PRs panel
  // ──────────────────────────────────────────────
  console.log('📸 My PRs panel...');
  const prPanel = page.locator('.group\\/card').nth(2);
  await prPanel.screenshot({ path: path.join(screenshotsDir, 'my-prs.png') });

  // ──────────────────────────────────────────────
  // 8. Notifications panel
  // ──────────────────────────────────────────────
  console.log('📸 Notifications panel...');
  const notifPanel = page.locator('.group\\/card').nth(3);
  await notifPanel.screenshot({ path: path.join(screenshotsDir, 'notifications.png') });

  // ──────────────────────────────────────────────
  // 9. Summary modal
  // ──────────────────────────────────────────────
  console.log('📸 Summary modal...');
  const summaryBtn = page.locator('button[aria-label="Summarize"]');
  if (await summaryBtn.count() > 0) {
    await summaryBtn.first().click();
    await page.waitForTimeout(500);
  }
  const summaryModal = page.locator('.fixed.inset-0');
  if (await summaryModal.count() > 0) {
    await summaryModal.first().screenshot({ path: path.join(screenshotsDir, 'summary.png') });
  }

  // Generate a demo summary to show the result
  console.log('📸 Summary with result...');
  const generateBtn = page.locator('button:has-text("Generate")');
  if (await generateBtn.count() > 0) {
    await generateBtn.first().click();
    await page.waitForTimeout(2500); // Wait for demo generation
  }
  if (await summaryModal.count() > 0) {
    await summaryModal.first().screenshot({ path: path.join(screenshotsDir, 'summary-result.png') });
  }

  // Close modal
  const closeBtn = page.locator('button:has-text("✕")');
  if (await closeBtn.count() > 0) {
    await closeBtn.first().click();
    await page.waitForTimeout(300);
  }

  // ──────────────────────────────────────────────
  // 10. Calendar picker
  // ──────────────────────────────────────────────
  console.log('📸 Calendar picker...');
  // Click the date button to open the calendar
  const dateBtn = page.locator('header button').filter({ hasText: /\d{4}/ });
  if (await dateBtn.count() > 0) {
    await dateBtn.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(screenshotsDir, 'calendar.png'), fullPage: false });

  // Close calendar by clicking elsewhere
  await page.locator('header').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  // ──────────────────────────────────────────────
  // 11. Settings panel
  // ──────────────────────────────────────────────
  console.log('📸 Settings panel...');
  const settingsBtn = page.locator('button[aria-label="Settings"]');
  if (await settingsBtn.count() > 0) {
    await settingsBtn.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(screenshotsDir, 'settings.png'), fullPage: false });

  // ──────────────────────────────────────────────
  // 12. Column layout
  // ──────────────────────────────────────────────
  console.log('📸 Column layout...');
  // Close settings first
  const closeSettings = page.locator('button:has-text("Close")');
  if (await closeSettings.count() > 0) {
    await closeSettings.first().click();
    await page.waitForTimeout(300);
  }
  const layoutBtn = page.locator('button[aria-label="Toggle layout"]');
  if (await layoutBtn.count() > 0) {
    await layoutBtn.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(screenshotsDir, 'column-layout.png'), fullPage: false });

  await browser.close();
  console.log('✅ All screenshots saved to screenshots/');
}

main().catch((err) => {
  console.error('Screenshot script failed:', err);
  process.exit(1);
});
