import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173/tools/mech-preview.html');await page.waitForFunction(()=>window.mechReview);
 await page.locator('#jump').click();await page.waitForFunction(()=>window.mechReview.motion().jumpJets===1);
 await page.screenshot({path:'build/mech-review/jump-thrusters.jpg',type:'jpeg',quality:65});
 await page.waitForFunction(()=>{const s=window.mechReview.motion();return !s.grounded&&s.jumpThrust===0;});
 const before=await page.evaluate(()=>window.mechReview.motion());
 await page.keyboard.press('Space');await page.waitForFunction(()=>window.mechReview.motion().jumpJets===1);
 const after=await page.evaluate(()=>window.mechReview.motion());assert.ok(after.velocityY>before.velocityY);assert.ok(after.height>before.height);
 await page.waitForFunction(()=>window.mechReview.motion().jumpJets===0);
 assert.deepEqual(errors,[]);console.log('PASS belly flames, airborne re-jump, re-ignition and extinction');
}finally{await browser.close();}
