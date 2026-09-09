import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173/tools/mech-preview.html');await page.waitForFunction(()=>window.mechReview);
 for(const direction of ['forward','backward','left','right']){
  await page.locator('#resetMotion').click();await page.locator('#'+direction).click();await page.locator('#dash').click();
  await page.waitForFunction(()=>{const s=window.mechReview.motion();return s.dashPowered&&s.jets>=2&&s.dashRemaining<.65&&s.dashRemaining>.25;});
  await page.screenshot({path:'build/mech-review/thrust-'+direction+'.jpg',type:'jpeg',quality:65});
  await page.waitForFunction(()=>{const s=window.mechReview.motion();return !s.dashPowered&&s.jets===0;});
 }
 assert.deepEqual(errors,[]);console.log('PASS four directional rocket bursts, extinction, no page errors');
}finally{await browser.close();}
