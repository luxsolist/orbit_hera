import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173/tools/mech-preview.html');
 for(const name of ['safety','link']){
  const result=await page.evaluate(async name=>{
   const THREE=await import('/node_modules/three/build/three.module.js');
   const {introScenes}=await import('/src/intro/scenes.ts');
   const {WALKER_ASSET}=await import('/src/assets/WalkerMech.ts');
   const shot=introScenes().find(s=>s.name===name);
   const ctx={scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(48,1280/720,.1,200)};
   shot.build(ctx);shot.update(name==='safety'?7:9,1/60,ctx);
   const mech=ctx.scene.getObjectByName('ED209_WALKER');
   const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,720);renderer.toneMapping=THREE.ACESFilmicToneMapping;
   document.body.replaceChildren(renderer.domElement);document.body.style.cssText='margin:0';renderer.render(ctx.scene,ctx.camera);
   const data={version:mech.userData.asset.version,current:WALKER_ASSET.version,skin:mech.userData.skinId,hullPorts:mech.getObjectByName('walker_body_thrusters').children.length,pelvisPorts:mech.getObjectByName('walker_pelvis_thrusters').children.length};
   return data;
  },name);
  assert.equal(result.version,result.current);assert.equal(result.skin,'base');assert.equal(result.hullPorts,8);assert.equal(result.pelvisPorts,1);
  await page.screenshot({path:`build/mech-review/intro-${name}.jpg`,type:'jpeg'});
 }
 assert.deepEqual(errors,[]);console.log('PASS both intro walker shots use current base asset with hull and pelvis nozzles');
}finally{await browser.close();}
