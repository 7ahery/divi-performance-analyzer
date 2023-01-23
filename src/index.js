import puppeteer from 'puppeteer';

require('dotenv').config();

async function measurePerformance() {
  const browser = await puppeteer.launch({
      headless: true,
      args: ['--ignore-certificate-errors', '--window-size=1920,1080'],
      slowMo: 50,
  });
  const page = await browser.newPage();
  await page.setViewport({
      width: 1920,
      height: 1080,
  });

  await loginToWordpress(browser);

  // Start tracing
  await page.tracing.start({
      path: 'trace.json',
      categories: ['devtools.timeline']
  });
  await Promise.all([page.coverage.startJSCoverage(), page.coverage.startCSSCoverage()]);

  // Total assets size
  let totalLoadSize = 0;
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  client.on('Network.responseReceived', (response) => {
      totalLoadSize += Number(response.response.encodedDataLength);
  });

  let jsFileSize = 0;
  page.on('response', async (response) => {
      if (response.url().includes('.js')) {
          const headers = response.headers();
          jsFileSize += Number(headers['content-length']);
      }
  });

  let cssFileSize = 0;
  page.on('response', async (response) => {
      if (response.url().includes('.css')) {
          const headers = response.headers();
          cssFileSize += Number(headers['content-length']);
      }
  });

  let imageSize = 0;
  await page.on('response', (response) => {
      const url = response.url();
      if (url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png') || url.endsWith('.gif')) {
          imageSize += response.headers()['content-length'];
      }
  });

  await page.goto(process.env.VB_URL, {
      waitUntil: "networkidle0"
  });

  const traceBuffer = await page.tracing.stop();
  const traceObject = JSON.parse(traceBuffer.toString());

  // Measure load time
  const loadTime = await page.evaluate(() => {
      const timing = window.performance.getEntriesByType("navigation")[0];
      const loadEventEnd = timing.loadEventEnd;
      const navigationStart = timing.navigationStart ?? 0;
      return loadEventEnd - navigationStart;
  });

  // Measure number of scripts and css loaded
  const scripts = await page.evaluate(() => Array.from(document.scripts).length);
  const css = await page.evaluate(() => Array.from(document.styleSheets).length);

  // Measure memory usage
  const memoryUsage = await page.metrics().then((metrics) => metrics.JSHeapUsedSize / 1000000);

  // Measure top 5 long tasks
  const longTasks = traceObject.traceEvents
      .filter(event => event.cat === 'devtools.timeline' && event.name === 'FunctionCall')
      .map(event => ({
          name: event.args.data.functionName,
          dur: event.dur
      }))
      .filter(task => task.dur > 50)
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 5);
  const topLongTasks = JSON.stringify(longTasks);

  // Code Coverage
  const [jsCoverage, cssCoverage] = await Promise.all([
      page.coverage.stopJSCoverage(),
      page.coverage.stopCSSCoverage(),
  ]);

  const calculateUsedBytes = (type, coverage) =>
    coverage.map(({
        url,
        ranges,
        text
    }) => {
      let usedBytes = 0;
      ranges.forEach((range) => (usedBytes += range.end - range.start - 1));
      return {
          url,
          type,
          usedBytes,
          totalBytes: text.length,
          percentUsed: usedBytes / text.length * 100
      };
    });

  const jsUsedBytes = calculateUsedBytes('js', jsCoverage);
  const jsCodeCoveragePercent = jsUsedBytes.reduce((prevValue, currentValue) => {
      return prevValue + currentValue.percentUsed;
  }, 0) / jsUsedBytes.length;
  const jsCodeCoverageNotUsedByte = jsUsedBytes.reduce((prevValue, currentValue) => {
      return prevValue + (currentValue.totalBytes - currentValue.usedBytes);
  }, 0);

  const cssUsedBytes = calculateUsedBytes('css', cssCoverage);
  const cssCodeCoveragePercent = cssUsedBytes.reduce((prevValue, currentValue) => {
      return prevValue + currentValue.percentUsed;
  }, 0) / cssUsedBytes.length;
  const cssCodeCoverageNotUsedByte = cssUsedBytes.reduce((prevValue, currentValue) => {
      return prevValue + (currentValue.totalBytes - currentValue.usedBytes);
  }, 0);

  // Measure Blurb module metrics
  const blurbModuleMetrics = await getBlurbModuleMetrics(page);
  const blurbModuleMetricsAfterHover = await getBlurbModuleMetricsAfterHover(page);

  console.log(`---------------------------------------------------------------------------`);
  console.log(`---------------------------- R E P O RT -----------------------------------`);
  console.log(`---------------------------------------------------------------------------`);

  console.log(`Load time: ${(loadTime/1000).toFixed(2)}s`);
  console.log(`Total load size of all assets: ${(totalLoadSize / 1000000).toFixed(2)} MB`);

  console.log(`Scripts loaded: ${scripts}`);
  console.log(`CSS loaded: ${css}`);

  console.log(`Total JS file size: ${(jsFileSize / 1000000).toFixed(2)} MB`);
  console.log(`Total CSS file size: ${(cssFileSize / 1000000).toFixed(2)} MB`);
  console.log(`Total image size: ${(imageSize / 1000000).toFixed(2)} MB`);

  console.log(`JS Code coverage: ${(jsCodeCoveragePercent).toFixed(2)}% (${(jsCodeCoverageNotUsedByte / 1000000).toFixed(2)} MB) not being used`);
  console.log(`CSS Code coverage: ${(cssCodeCoveragePercent).toFixed(2)}% (${(cssCodeCoverageNotUsedByte / 1000000).toFixed(2)} MB) not being used`);

  console.log(`Memory usage: ${(memoryUsage).toFixed(2)} MB`);

  console.log(`Top 5 long tasks: ${topLongTasks}`);
  
  console.log(`Blurb module was started to render after: ${(blurbModuleMetrics[0].startTime/1000).toFixed(2)}s`);
  console.log(`Blurb module was rendered: ${blurbModuleMetrics.length} times after VB initial loading`);
  console.log(`Blurb module was rendered: ${blurbModuleMetricsAfterHover.length} times after one hover interaction`);

  await browser.close();
}

async function getBlurbModuleMetrics(page) {
  const iframeHandler = await page.$('iframe#et-vb-app-frame');

  const frame = await iframeHandler.contentFrame();

  const rawEntries = await frame.evaluate(function () {
    return JSON.stringify(window.performance.getEntries());
  });

  const entries = JSON.parse(rawEntries);

  const renderedEvent = entries.filter((item) => item.name.includes("blurb-module-rendered") );

  return renderedEvent;
}

async function getBlurbModuleMetricsAfterHover(page) {
  const iframeHandler = await page.$('iframe#et-vb-app-frame');

  const frame = await iframeHandler.contentFrame();

  const element = await frame.$('.et_pb_blurb_content');
  await element.hover();

  const rawEntries = await frame.evaluate(function () {
    return JSON.stringify(window.performance.getEntries());
  });

  const entries = JSON.parse(rawEntries);

  const renderedEvent = entries.filter((item) => item.name.includes("blurb-module-rendered") );

  return renderedEvent;
}

async function loginToWordpress(browser) {
  const page = await browser.newPage();
  await page.goto(process.env.LOGIN_URL);
  await page.type('#user_login', 'admin');
  await page.type('#user_pass', 'admin');
  await page.click('#wp-submit');
  await page.waitForSelector('#wpcontent');
  await page.close();
  console.log('Logged in successfully! \n');
}

measurePerformance();