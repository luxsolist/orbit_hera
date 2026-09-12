import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.goto('http://localhost:5173/tools/flyer-preview.html');await page.waitForFunction(()=>window.flyerReview?.motion);
 for(const [id,axis,speed] of [['forward','velocityZ',111.11],['backward','velocityZ',-111.11*.6],['left','velocityX',111.11*.85],['right','velocityX',-111.11*.85],['up','velocityY',45],['down','velocityY',-45]]){
  await page.locator('#resetMotion').click();await page.locator('#'+id).click();
  await page.waitForFunction(({axis,speed})=>Math.abs(window.flyerReview.motion()[axis]-speed)<.15,{axis,speed});
  const state=await page.evaluate(()=>window.flyerReview.motion());assert.equal(state.active,true);if(id==='left'||id==='right')assert.ok(Math.abs(state.bank)>.1);
  console.log('PASS',id);if(id==='left')await page.screenshot({path:'build/mech-review/flyer-motion.jpg',type:'jpeg'});
 }
 await page.locator('#stop').click();await page.waitForFunction(()=>{const s=window.flyerReview.motion();return Math.hypot(s.velocityX,s.velocityZ,s.velocityY)<.1;});
 await page.locator('#resetMotion').click();await page.keyboard.down('KeyW');await page.waitForFunction(()=>window.flyerReview.motion().velocityZ>100);await page.keyboard.up('KeyW');
 await page.locator('#heading').fill('90');await page.locator('#forward').click();await page.waitForFunction(()=>window.flyerReview.motion().velocityX>100);
 await page.locator('#stop').click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await page.locator('#resetMotion').click();const reset=await page.evaluate(()=>window.flyerReview.motion());assert.equal(reset.active,false);assert.equal(reset.x,0);assert.equal(reset.height,98);
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth===390);
 assert.deepEqual(errors,[]);console.log('PASS hover, keyboard, heading, reset, responsive layout');
}finally{await browser.close();}
