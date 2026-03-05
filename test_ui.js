const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Navigate to local server
  await page.goto('http://127.0.0.1:5000');

  // Wait a bit
  await page.waitForTimeout(2000);

  // Take a screenshot to verify UI loaded
  await page.screenshot({ path: 'ui_screenshot.png' });

  // Check console for errors
  page.on('console', msg => {
    if (msg.type() === 'error')
      console.log(`PAGE LOG ERROR: ${msg.text()}`);
  });

  page.on('pageerror', error => {
    console.log(`PAGE ERROR: ${error.message}`);
  });

  const text = await page.evaluate(() => {
    const el = document.querySelector('body');
    return el ? el.innerHTML.slice(0, 100) : null;
  });
  console.log("Body starts with:", text);

  await browser.close();
})();
