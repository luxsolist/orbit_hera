import {it,expect} from 'vitest';
import {EdgeAntialiasPass} from '../src/fx/postprocessing';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import * as THREE from 'three';
it('follows composer physical resolution on resize and pixel-ratio changes',()=>{
 const renderer={getPixelRatio:()=>2,getSize:(v:THREE.Vector2)=>v.set(800,600)} as THREE.WebGLRenderer;
 const composer=new EffectComposer(renderer),pass=new EdgeAntialiasPass();composer.addPass(pass);
 expect(pass.uniforms.resolution.value.toArray()).toEqual([1/1600,1/1200]);
 composer.setSize(400,300);expect(pass.uniforms.resolution.value.toArray()).toEqual([1/800,1/600]);
 composer.setPixelRatio(1);expect(pass.uniforms.resolution.value.toArray()).toEqual([1/400,1/300]);
 pass.setSize(0,0);expect(pass.uniforms.resolution.value.toArray()).toEqual([1,1]);
 pass.dispose();composer.dispose();
});
