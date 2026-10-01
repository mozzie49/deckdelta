import {test, expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

function jpegFrameSize(data: Buffer): string {
  if (data.readUInt16BE(0) !== 0xffd8) return 'invalid';
  let offset = 2;
  while (offset + 4 < data.length) {
    if (data[offset++] !== 0xff) return 'invalid';
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 1) continue;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return 'invalid';
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 7) return 'invalid';
      return `${data.readUInt16BE(offset + 5)}x${data.readUInt16BE(offset + 3)}`;
    }
    offset += length;
  }
  return 'invalid';
}

test('record and verify the real sample walkthrough', async ({page, browser}) => {
  let started = 0;
  const capturedFrameSizes = new Set<string>();
  const cues: {start: number; text: string}[] = [];
  const external: string[] = [], errors: string[] = [];
  const cue = (text: string) => cues.push({start: (performance.now() - started) / 1000, text});
  const stamp = (seconds: number) => new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 23);
  const captions = (duration: number) => 'WEBVTT\n\n' + cues.map((item, index) => `${index + 1}\n${stamp(item.start)} --> ${stamp(cues[index + 1]?.start ?? duration)}\n${item.text}\n`).join('\n');
  page.on('request', request => {
    if (!/^(http:\/\/127\.0\.0\.1:4173\/|blob:|data:)/.test(request.url())) external.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  const settle = async () => {
    await page.locator('.viewer img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
    // Ordinary scrolling keeps the selected mapping beside the inspector in the recording.
    await page.locator('.map-list').evaluate(map => {
      const row = map.querySelector('.map-row.active')!;
      map.scrollTop += row.getBoundingClientRect().top - map.getBoundingClientRect().top - 12;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.map-row.active .map-top')).toBeInViewport();
  };

  await page.goto('/');
  await expect(page.locator('#demo-button')).toBeInViewport();
  // Start recording explicitly after page setup, then start the caption clock at the same boundary.
  await page.screencast.start({path: 'dist/deckdelta-demo.webm', size: {width: 1440, height: 1000}, onFrame: ({data}) => { capturedFrameSizes.add(jpegFrameSize(data)); }});
  started = performance.now();
  cue('One click loads the original fictional sample decks.');
  // These waits are reading time in an unsped-up recording, not synchronization.
  await page.waitForTimeout(800);
  await page.locator('#demo-button').click();
  await expect(page.locator('#export-button')).toBeVisible({timeout: 45_000});
  await expect(page.locator('.map-row')).toHaveCount(11);
  await expect(page.locator('[data-filter="moved"] b')).toHaveText('04');

  await page.locator('[data-filter="moved"]').click();
  await page.locator('[data-row="before-4"]').click();
  await expect(page.locator('.inspector-head h2')).toHaveText('Before 4 → After 2');
  await expect(page.locator('.inspector-head .badge.moved')).toHaveText('Moved');
  await expect(page.locator('.inspector-head .badge.changed')).toHaveText('Changed');
  await expect(page.locator('.text-analysis')).toContainText('No extracted text changes detected.');
  const renderedDifference = await page.locator('.visual-analysis h3 span').innerText();
  expect(parseFloat(renderedDifference)).toBeGreaterThan(0);
  await settle();
  cue('Slide 4 moved to 2. Its chart changed; the extracted text did not.');
  await page.screenshot({path: 'dist/deckdelta-preview.png', animations: 'disabled'});
  await page.waitForTimeout(3500);

  await page.locator('[data-filter="changed"]').click();
  await page.locator('[data-row="before-3"]').click();
  await expect(page.locator('.inspector-head h2')).toHaveText('Before 3 → After 3');
  await expect(page.locator('.number-diff.removed')).toContainText('$39');
  await expect(page.locator('.number-diff.added')).toContainText('$49');
  await settle();
  cue('The price also changed: $39 removed, $49 added.');
  await page.waitForTimeout(2700);

  await page.locator('[data-filter="uncertain"]').click();
  await expect(page.locator('.map-row')).toHaveCount(2);
  await expect(page.locator('.inspector-head .badge.uncertain')).toHaveText('Check match');
  await expect(page.locator('.match-alert')).toContainText('Similar alternative matches or duplicate pages');
  await settle();
  cue('Identical appendix pages stay uncertain: check this match.');
  await page.waitForTimeout(2700);

  await page.locator('.manual-match summary').click();
  await expect(page.locator('#match-select')).toBeVisible();
  await expect(page.locator('#apply-match')).toBeVisible();
  await page.locator('.manual-match').scrollIntoViewIfNeeded();
  cue('You can choose the pairing yourself. A human decision is still needed.');
  await page.waitForTimeout(Math.max(2000, 15_000 - (performance.now() - started)));
  expect(external).toEqual([]);
  expect(errors).toEqual([]);

  // Save native Playwright video, without trimming, retiming, overlays, or a movie pipeline.
  const observedSeconds = (performance.now() - started) / 1000;
  await page.screencast.stop();
  expect([...capturedFrameSizes]).toEqual(['1440x1000']);
  await writeFile('dist/deckdelta-demo.vtt', captions(observedSeconds));

  // Read the actual saved media in Chromium. A timing or playback failure blocks publication.
  const playback = await browser.newPage({baseURL: 'http://127.0.0.1:4173'});
  try {
    await playback.goto('/demo.html');
    const media = playback.locator('video');
    await expect.poll(() => media.evaluate((video: HTMLVideoElement) => Number.isFinite(video.duration) && video.duration > 0)).toBe(true);
    const duration = await media.evaluate((video: HTMLVideoElement) => video.duration);
    expect(duration).toBeGreaterThanOrEqual(12);
    expect(duration).toBeLessThanOrEqual(20);
    await media.evaluate((video: HTMLVideoElement) => { video.muted = true; return video.play(); });
    await expect.poll(() => media.evaluate((video: HTMLVideoElement) => video.ended), {timeout: 25_000}).toBe(true);
    expect(await media.evaluate((video: HTMLVideoElement) => video.error)).toBeNull();
    await writeFile('dist/deckdelta-demo.vtt', captions(duration));
    await writeFile('dist/deckdelta-demo.json', JSON.stringify({
      sourceCommit: process.env.GITHUB_SHA ?? null,
      recordedAt: new Date().toISOString(),
      durationSeconds: duration,
      viewport: {width: 1440, height: 1000},
      source: 'Real Chromium recording of the included fictional Aster Studio PDFs',
      playbackSpeed: 1,
      capturedFrameSizes: [...capturedFrameSizes],
      verified: {chartPair: '4 → 2', chartMoved: true, chartChanged: true, chartTextUnchanged: true, renderedDifference, pricePair: '3 → 3', priceRemoved: '$39', priceAdded: '$49', uncertainDuplicates: 2, manualPairingControlsShown: true, externalRequests: external, pageErrors: errors},
      captions: cues,
    }, null, 2) + '\n');
    // Captions were generated from observed scene times; verify the published track loads too.
    await playback.reload();
    await expect.poll(() => playback.locator('track').evaluate((track: HTMLTrackElement) => track.readyState)).toBe(2);
    await expect.poll(() => playback.locator('track').evaluate((track: HTMLTrackElement) => track.track.cues?.length)).toBe(cues.length);
    await expect(playback.getByRole('link', {name: 'Try the sample decks →'})).toHaveAttribute('href', './');
    await playback.setViewportSize({width: 390, height: 844});
    expect(await playback.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    console.log(`Verified native browser walkthrough: ${duration.toFixed(2)}s`);
  } finally {
    await playback.close();
  }
});
