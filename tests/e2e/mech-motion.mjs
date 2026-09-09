import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173/tools/mech-preview.html');await page.waitForFunction(()=>window.mechReview);
 for(const [id,speed] of [['forward',4.8],['backward',-2.7],['left',3.0],['right',-3.0]]){
  await page.locator('#'+id).click();await page.waitForFunction(({id,speed})=>{const s=window.mechReview.motion();return Math.abs((id==="forward"||id==="backward"?s.velocityZ:s.velocityX)-speed)<.02;},{id,speed});
  console.log(id,await page.evaluate(()=>window.mechReview.motion()));
 }
 await page.locator('#stop').click();await page.waitForFunction(()=>{const s=window.mechReview.motion();return Math.hypot(s.velocityX,s.velocityZ)<.1;});
 await page.keyboard.down('KeyW');await page.waitForFunction(()=>window.mechReview.motion().velocityZ>4.75);await page.keyboard.up('KeyW');
 await page.locator('#jump').click();await page.waitForFunction(()=>window.mechReview.motion().height>0.7);
 await page.screenshot({path:'build/mech-review/motion-jump.jpg',type:'jpeg',quality:65});
 await page.waitForFunction(()=>window.mechReview.motion().grounded);
 await page.locator('#dash').click();await page.waitForFunction(()=>window.mechReview.motion().dashCooldown>1);
 await page.locator('#forward').click();await page.waitForFunction(()=>Math.abs(window.mechReview.motion().velocityZ-4.8)<.02);
 await page.screenshot({path:'build/mech-review/motion-forward.jpg',type:'jpeg',quality:65});
 await page.locator('#resetMotion').click();assert.equal(await page.evaluate(()=>window.mechReview.motion().height),0);
 assert.deepEqual(errors,[]);console.log('motion preview inputs / jump / dash / reset: PASS');
}finally{await browser.close();}
