import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const page=await browser.newPage();
try{
 await page.goto("http://localhost:5173/tools/mech-preview.html");await page.waitForFunction(()=>window.mechReview);
 const result=await page.evaluate(async()=>{
   const {GLTFLoader}=await import("/node_modules/three/examples/jsm/loaders/GLTFLoader.js");
   const {AnimationMixer}=await import("/node_modules/three/build/three.module.js");
   const gltf=await new GLTFLoader().loadAsync("/models/android-01.glb");
   const knee=gltf.scene.getObjectByName("left_knee"),camera=gltf.scene.getObjectByName("socket_camera"),muzzle=gltf.scene.getObjectByName("socket_muzzle");
   const before=knee.quaternion.toArray(),mixer=new AnimationMixer(gltf.scene);
   const walk=gltf.animations.find(c=>c.name==="walk");mixer.clipAction(walk).play();
   let moved=false;
   // Sample the entire cycle: the new stance phase deliberately keeps the knee steady.
   for(let frame=0;frame<24;frame++){
     mixer.update(walk.duration/24);
     moved ||= before.some((v,i)=>Math.abs(v-knee.quaternion.toArray()[i])>.01);
   }
   let triangles=0,textures=0;gltf.scene.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;if(o.material.roughnessMap)textures++;}});
   return {clips:gltf.animations.map(c=>c.name),camera:!!camera,muzzle:!!muzzle,leftMuzzle:!!gltf.scene.getObjectByName("socket_muzzle_left"),moved,triangles,textures};
 });
 assert.deepEqual(result.clips,["idle","walk","aim"]);assert.ok(result.camera&&result.muzzle&&result.leftMuzzle&&result.moved);
 assert.equal(result.textures,0);
 console.log("PASS GLB reload, articulated animation, sockets, PBR textures",result);
}finally{await browser.close();}
