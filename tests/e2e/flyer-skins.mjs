import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.goto('http://localhost:5173/tools/flyer-preview.html');await page.locator('[data-skin=dune]').waitFor();
 for(const id of ['obsidian','polar','dune']){
  await page.locator(`[data-skin=${id}]`).click();assert.equal(await page.evaluate(()=>window.flyerReview.motion().skinId),id);
  await page.screenshot({path:`build/mech-review/flyer-${id}.jpg`,type:'jpeg'});
 }
 const result=await page.evaluate(async()=>{
  const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const bytes=await window.flyerReview.exportBuffer();const model=await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'');
  const body=model.scene.getObjectByName('curved_pointed_hull');return {color:body.material.color.getHexString(),garnish:!!model.scene.getObjectByName('flyer_skin_garnish')};
 });assert.equal(result.color,'e8b644');assert.equal(result.garnish,true);
 await page.locator('#forward').click();await page.waitForFunction(()=>window.flyerReview.motion().velocityZ>90);
 await page.locator('[data-skin=polar]').click();assert.ok(await page.evaluate(()=>window.flyerReview.motion().velocityZ>90));
 await page.locator('#resetMotion').click();await page.locator('[data-skin=base]').click();assert.equal(await page.evaluate(()=>window.flyerReview.motion().skinId),'base');
 assert.deepEqual(errors,[]);console.log('PASS flyer skins, gold GLB roundtrip, in-flight switching and base reset');
}finally{await browser.close();}
