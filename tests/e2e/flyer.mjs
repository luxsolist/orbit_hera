import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.goto('http://localhost:5173/tools/flyer-preview.html');await page.waitForFunction(()=>window.flyerReview&&document.querySelector('#spec').textContent.includes('400km/h'));
 for(const v of ['three','top','rear','bottom']){await page.locator(`[data-view="${v}"]`).click();await page.screenshot({path:`build/mech-review/flyer-${v}.jpg`,type:'jpeg'});}
 await page.locator('[data-view=side]').click();await page.locator('#throttle').fill('1');await page.screenshot({path:'build/mech-review/flyer-exhaust.jpg',type:'jpeg'});await page.locator('#bank').fill('16');
 const data=await page.evaluate(()=>window.flyerReview.exportBuffer());assert.ok(data.length>10000);
 await writeFile('public/models/drone-v1.glb',Buffer.from(data));
 await page.evaluate(async bytes=>{const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const glb=await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'');if(!glb.scene.getObjectByName('socket_muzzle')||!glb.scene.getObjectByName('socket_camera'))throw new Error('Missing sockets');if(glb.scene.getObjectByName('beam_barrel_1')||!glb.scene.getObjectByName('beam_emitter_lens_1')||!glb.scene.getObjectByName('beam_emitter_lens_-1'))throw new Error('Expected lens emitters without barrels');},data);
 assert.deepEqual(errors,[]);console.log('PASS flyer views, controls, current spec and GLB roundtrip');
}finally{await browser.close();}
