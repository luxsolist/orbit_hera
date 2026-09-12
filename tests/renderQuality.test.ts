import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {renderPixelRatio} from '../src/core/renderQuality';
import {HalfResolutionBloomPass} from '../src/fx/postprocessing';
import {LensDistortPass} from '../src/fx/LensDistortPass';
describe('render budget',()=>{
  it('caps retina desktop at 1080p and preserves smaller displays without supersampling',()=>{
    expect(renderPixelRatio(2560,1440,1.5)).toBe(.75);
    expect(renderPixelRatio(1920,1080,2)).toBe(1);
    expect(renderPixelRatio(390,844,3)).toBe(1);
  });
  it('keeps bloom targets scaled after repeated composer resizes',()=>{
    const b=new HalfResolutionBloomPass(new THREE.Vector2(1,1),.85,.6,.75);
    b.setSize(1920,1080);expect(b.renderTargetBright.width).toBe(480);expect(b.renderTargetBright.height).toBe(270);
    b.setSize(1280,720);expect(b.renderTargetBright.width).toBe(320);b.dispose();
  });
  it('skips empty distortion frames and re-enables immediately when a target appears',()=>{
    const p=new LensDistortPass();expect(p.enabled).toBe(false);
    p.setPoints([{x:.5,y:.5,radius:.1,strength:1}]);expect(p.enabled).toBe(true);
    p.setPoints([]);expect(p.enabled).toBe(false);p.dispose();
  });
});
