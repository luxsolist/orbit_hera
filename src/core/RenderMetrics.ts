import type * as THREE from 'three';
export interface WorldRenderMetrics {active:number;prepared:number;cached:number;pending:number;buildMs:number;maxBuildMs:number;collisionMs:number;maxCollisionMs:number;preparationMs?:number;activationMs?:number;}
/** Shared, opt-in display; CPU submission time is not GPU execution time. */
export class RenderMetrics {
 private frames:number[]=[];private times:number[]=[];private last=0;private start=0;private next=0;
 private el?:HTMLElement;private previousAutoReset=true;private renderer?:THREE.WebGLRenderer;
 constructor(host?:HTMLElement){if(host){this.el=document.createElement('div');this.el.className='render-metrics';this.el.style.cssText='white-space:pre-wrap;font:12px/1.5 monospace;padding:8px;color:#bdefff;background:#102030';this.el.textContent='성능 측정 준비 중…';host.append(this.el);}}
 begin(renderer:THREE.WebGLRenderer){if(!this.el)return;const now=performance.now();
  if(document.hidden){this.reset();return;}
  if(this.last){this.frames.push(now-this.last);this.times.push(now);}this.last=now;while(this.frames.length>600||(this.times[0]??now)<now-5000){this.frames.shift();this.times.shift();}
  this.start=now;if(!this.renderer){this.renderer=renderer;this.previousAutoReset=renderer.info.autoReset;renderer.info.autoReset=false;}renderer.info.reset();
 }
 end(renderer:THREE.WebGLRenderer,world?:WorldRenderMetrics){if(!this.el||document.hidden)return;const now=performance.now();if(now<this.next)return;this.next=now+500;
  const sorted=this.frames.slice().sort((a,b)=>a-b),sum=this.frames.reduce((a,b)=>a+b,0),p95=sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??0;
  this.el.textContent=`평균 ${sum?(1000*this.frames.length/sum).toFixed(1):'—'} FPS · p95 ${p95.toFixed(1)}ms\nCPU 프레임 ${(now-this.start).toFixed(1)}ms (GPU 시간 제외)\n삼각형 ${renderer.info.render.triangles.toLocaleString()} · 그리기 ${renderer.info.render.calls}회`+
   (world?`\n활성 ${world.active} · 선준비 ${world.prepared} · 캐시 ${world.cached} · 대기 ${world.pending}\n타일 생성 최대 ${world.maxBuildMs.toFixed(1)}ms · 충돌 갱신 최대 ${world.maxCollisionMs.toFixed(1)}ms`+(world.preparationMs!==undefined?`\n별도 생성 최대 ${world.preparationMs.toFixed(1)}ms · 활성화 최대 ${(world.activationMs??0).toFixed(1)}ms`:''):'');
 }
 reset(){this.frames=[];this.times=[];this.last=0;this.next=0;}
 dispose(){if(this.renderer)this.renderer.info.autoReset=this.previousAutoReset;this.el?.remove();}
}
