import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {PDFDocument,StandardFonts} from 'pdf-lib';

test('real PDF sample, review states, corrections, private portable export',async({page})=>{
 const external:string[]=[];const errors:string[]=[];
 await page.setViewportSize({width:1440,height:1000});
 page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173/')&&!request.url().startsWith('blob:')&&!request.url().startsWith('data:'))external.push(request.url());});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.locator('#demo-button').click();
 await expect(page.locator('#export-button')).toBeVisible({timeout:45_000});
 await expect(page.locator('.map-row')).toHaveCount(11);
 await expect(page.locator('[data-filter="changed"] b')).toHaveText('03');
 await expect(page.locator('[data-filter="added"] b')).toHaveText('01');
 await expect(page.locator('[data-filter="deleted"] b')).toHaveText('01');
 await expect(page.locator('[data-filter="uncertain"] b')).toHaveText('02');
 await page.locator('[data-row="before-3"]').click();
 await expect(page.locator('.number-analysis')).toContainText('$39');await expect(page.locator('.number-analysis')).toContainText('$49');
 await expect(page.locator('.map-row.active')).toHaveAttribute('data-row','before-3');
 await expect(page.locator('.slide-map')).toBeVisible();
 // Lead with the differentiator: a chart edit on a slide that moved from 4 to 2.
 await page.locator('[data-row="before-4"]').click();
 await expect(page.locator('.inspector-head h2')).toHaveText('Before 4 → After 2');
 await expect(page.locator('.inspector-head .badge.changed')).toHaveText('Changed');
 await expect(page.locator('.inspector-head .badge.moved')).toHaveText('Moved');
 await expect(page.locator('.text-analysis')).toContainText('No extracted text changes detected.');
 await page.locator('.viewer img').evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode())));
 // Keep the selected 04 → 02 card visible beside the chart, using ordinary scrolling.
 await page.locator('.map-list').evaluate(map=>{const row=map.querySelector('.map-row.active')!;map.scrollTop+=row.getBoundingClientRect().top-map.getBoundingClientRect().top-12;});
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(page.locator('.map-row.active .map-top')).toBeInViewport();
 // A real, verified product screenshot. Pages publishes dist after this test succeeds.
 await page.screenshot({path:'dist/deckdelta-preview.png',fullPage:false,animations:'disabled'});
 // Selecting a deep slide and rerendering the inspector must not jump the slide map.
 await page.locator('.map-list').evaluate(element=>{element.scrollTop=element.scrollHeight;});
 const deepScroll=await page.locator('.map-list').evaluate(element=>element.scrollTop);
 expect(deepScroll).toBeGreaterThan(0);
 await page.locator('[data-row="before-10"]').click();
 await expect(page.locator('.map-row.active')).toHaveAttribute('data-row','before-10');
 expect(await page.locator('.map-list').evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
 expect(await page.locator('.map-row.active').evaluate(element=>{const row=element.getBoundingClientRect();const map=element.parentElement!.getBoundingClientRect();return row.top>=map.top&&row.bottom<=map.bottom;})).toBe(true);
 await page.locator('[data-view="overlay"]').click();
 expect(await page.locator('.map-list').evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
 // A new filter should start at its beginning rather than retain the old deck-map offset.
 await page.locator('[data-filter="uncertain"]').click();
 expect(await page.locator('.map-list').evaluate(element=>element.scrollTop)).toBe(0);
 await page.locator('[data-filter="all"]').click();
 expect(await page.locator('.map-list').evaluate(element=>element.scrollTop)).toBe(0);
 await page.locator('[data-row="before-3"]').click();

 await page.locator('[data-view="overlay"]').click();await expect(page.locator('#opacity-range')).toBeVisible();await page.locator('#opacity-range').fill('70');await expect(page.locator('#overlay-image')).toHaveCSS('opacity','0.7');
 await page.locator('[data-view="side"]').click();await page.locator('[data-preview="before"]').click();await expect(page.locator('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('dialog')).toHaveCount(0);
 await page.locator('#review-notes').fill('Check revised price <script>alert(1)</script>');await page.locator('#reviewed-button').click();
 await page.locator('.manual-match summary').click();await page.locator('#match-select').selectOption('5');await page.locator('#apply-match').click();
 await expect(page.locator('#review-notes')).toContainText('Note from previous pairing: Before 3 → After 3');
 await expect(page.locator('#reviewed-button')).toHaveText('Mark reviewed');
 const downloadPromise=page.waitForEvent('download');await page.locator('#export-button').click();const download=await downloadPromise;const html=await readFile((await download.path())!,'utf8');
 expect(html).toContain('Note from previous pairing');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('data:image/png;base64,');expect(html).toContain('Similar alternative matches or duplicate pages');
 expect(external).toEqual([]);expect(errors).toEqual([]);
 await page.locator('#language-button').click();await expect(page.locator('#export-button')).toContainText('导出审阅');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator('.map-list').evaluate(element=>{element.scrollLeft=element.scrollWidth;});
 await page.locator('[data-row="before-10"]').click();
 expect(await page.locator('.map-list').evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);

});

test('cancel, replace, repeat, and reject invalid or oversized PDFs',async({page})=>{
 await page.goto('/');
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('.hero h1')).toContainText('Compare PDF decks,');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator('#language-button').click();
 await expect(page.locator('.hero h1')).toContainText('页面换位也能追踪。');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator('#language-button').click();
 await page.setViewportSize({width:1280,height:720});
 await page.locator('#demo-button').click();await page.locator('#cancel-button').click();await expect(page.locator('#compare-button')).toBeVisible();await expect(page.locator('#export-button')).toHaveCount(0);
 await page.locator('#before-file').setInputFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});await page.locator('#after-file').setInputFiles('public/samples/aster-after.pdf');await page.locator('#compare-button').click();await expect(page.locator('[role="alert"]')).toContainText('valid PDF');
 await page.locator('#before-file').setInputFiles('public/samples/aster-before.pdf');await page.locator('#compare-button').click();await expect(page.locator('#export-button')).toBeVisible({timeout:45_000});await page.locator('#reset-button').click();await expect(page.locator('#compare-button')).toBeDisabled();
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);for(let i=0;i<51;i++){const p=pdf.addPage([960,540]);p.drawText('Limit fixture page '+(i+1),{font});}const buffer=Buffer.from(await pdf.save());
 await page.locator('#before-file').setInputFiles({name:'too-many.pdf',mimeType:'application/pdf',buffer});await page.locator('#after-file').setInputFiles('public/samples/aster-after.pdf');await page.locator('#compare-button').click();await expect(page.locator('[role="alert"]')).toContainText('51 pages');
 const blank=await PDFDocument.create();blank.addPage([960,540]);await page.locator('#before-file').setInputFiles({name:'no-text.pdf',mimeType:'application/pdf',buffer:Buffer.from(await blank.save())});await page.locator('#compare-button').click();await expect(page.locator('[role="alert"]')).toContainText('No extractable text');
});
