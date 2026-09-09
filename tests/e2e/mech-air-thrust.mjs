import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173/tools/mech-preview.html');await page.waitForFunction(()=>window.mechReview);
 for(const direction of ['forward','backward','left','right']){
  await page.locator('#resetMotion').click();await page.locator('#'+direction).click();await page.locator('#jump').click();
  await page.waitForFunction(()=>{const s=window.mechReview.motion();return !s.grounded&&s.jets-s.jumpJets>=2&&!s.dashPowered;});
  if(direction==='left')await page.screenshot({path:'build/mech-review/air-thrust.jpg',type:'jpeg',quality:65});
  await page.locator('#stop').click();await page.waitForFunction(()=>{const s=window.mechReview.motion();return s.jets-s.jumpJets===0;});
 }
 assert.deepEqual(errors,[]);console.log('PASS air control jets in four directions and release');
}finally{await browser.close();}
