import {test,expect} from '@playwright/test';

test('walkthrough sample link opens a review in one click and stays one-shot',async({page})=>{
 const sampleRequests:string[]=[];
 page.on('request',request=>{if(/\/samples\/aster-(before|after)\.pdf$/.test(request.url()))sampleRequests.push(request.url());});
 // The ordinary entry stays an empty, manual comparison form.
 await page.goto('/');
 await expect(page.locator('#compare-button')).toBeDisabled();
 await expect(page.locator('#demo-button')).toBeEnabled();
 expect(sampleRequests).toHaveLength(0);

 await page.goto('/demo.html');
 await page.getByRole('link',{name:'Try the sample decks →'}).click();
 await expect(page).toHaveURL(/\?sample=1$/);
 await expect(page.locator('#export-button')).toBeVisible({timeout:45_000});
 await expect(page.locator('.map-row')).toHaveCount(11);
 expect(sampleRequests).toHaveLength(2);

 // In-page navigation and rerenders must not restart or erase the review.
 await page.locator('#reviewed-button').click();
 await page.goto('/?sample=1#review');
 await expect(page.locator('.review-subline')).toContainText('1/11 Reviewed');
 expect(sampleRequests).toHaveLength(2);
 await page.reload();
 await expect(page.locator('#export-button')).toBeVisible({timeout:45_000});
 await expect(page.locator('.review-subline')).toContainText('0/11 Reviewed');
 expect(sampleRequests).toHaveLength(4);

 await page.locator('#reset-button').click();
 await expect(page.locator('#compare-button')).toBeDisabled();
 await expect(page.locator('#export-button')).toHaveCount(0);
 await page.locator('#language-button').click();
 await expect(page.locator('#demo-button')).toBeEnabled();
 expect(sampleRequests).toHaveLength(4);
});

test('direct sample loading can be cancelled and retried',async({page})=>{
 let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/samples/aster-*.pdf',async route=>{
  await held;
  await route.continue().catch(()=>{}); // Cancellation can abort this held request.
 });
 try{
  await page.goto('/?sample=1');
  await expect(page.locator('#cancel-button')).toBeVisible();
  await page.locator('#cancel-button').click();
 }finally{release();}
 await page.unroute('**/samples/aster-*.pdf');
 await expect(page.locator('#demo-button')).toBeEnabled();
 await expect(page.locator('#export-button')).toHaveCount(0);
 await expect(page.locator('.notice')).toContainText('cancelled');
 await page.locator('#demo-button').click();
 await expect(page.locator('#export-button')).toBeVisible({timeout:45_000});
 await expect(page.locator('.map-row')).toHaveCount(11);
});
