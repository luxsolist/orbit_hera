import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.goto('http://localhost:5173/tools/mech-preview.html');await page.waitForFunction(()=>window.mechReview);
 assert.equal(await page.evaluate(()=>window.mechReview.motion().skinId),"base");
 await page.screenshot({path:"build/mech-review/skin-base.jpg",type:"jpeg",quality:65});
 for(const id of ['obsidian','polar','dune']){
  await page.locator(`[data-skin="${id}"]`).click();
  assert.equal(await page.evaluate(()=>window.mechReview.motion().skinId),id);
  assert.equal(await page.locator(`[data-skin="${id}"]`).getAttribute('aria-pressed'),'true');

  await page.screenshot({path:`build/mech-review/skin-${id}.jpg`,type:'jpeg',quality:65});
 }
 await page.locator('[data-skin="polar"]').click();
 const exported=await page.evaluate(async()=>{
  const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const bytes=await window.mechReview.exportBuffer();
  const model=await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'');
  const slots={};model.scene.traverse(n=>{if(n.isMesh){const m=n.material;slots[m.userData.skinSlot]={name:m.name,color:m.color.getHexString()};}});
  return {slots,clips:model.animations.map(c=>c.name)};
 });
 assert.equal(exported.slots.armor.color,'d8e4e5');assert.equal(exported.slots.trim.color,'ef682c');assert.equal(Object.keys(exported.slots).length,6);
 assert.deepEqual(exported.clips,['idle','walk','aim']);
 await page.locator('[data-skin="base"]').click();
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;
 await download.saveAs('public/models/android-01.glb');
 assert.deepEqual(errors,[]);console.log('PASS three skin selections, stable model, selected-skin GLB round trip, refreshed default GLB');
}finally{await browser.close();}
