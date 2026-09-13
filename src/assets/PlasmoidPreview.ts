import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {PlasmoidVisual,type PlasmoidKind,type PlasmoidPose} from './PlasmoidVisual';

const definitions: [PlasmoidKind,string,string,string][]=[
 ['base','공통 기본형','밝은 핵 · 흐르는 구체 · 투명하게 퍼지는 외곽','#62cfff'],
 ['leech','거머리','앞으로 뻗은 짧고 굵은 에너지 돌기. 돌진 방향을 보여줍니다.','#ffab72'],
 ['skeeter','모기','길고 가느다란 세 갈래 꼬리. 원거리 공격형의 실루엣입니다.','#86dfff'],
 ['brander','소인체','빛의 조각 3개로 된 고리. 전방으로 정렬해 표식을 발사하고 조각별로 복원합니다.','#d2a0ff'],
 ['elite','정예','거머리의 전면 돌기와 모기의 긴 꼬리를 함께 가집니다.','#ffa0ce'],
 ['boss','보스','고리 없는 코로나와 위성 구체. 공격 준비 시 중심으로 응축됩니다.','#ffd779'],
];
const select=(id:string)=>document.getElementById(id) as HTMLSelectElement;
let paused=false,time=0;
document.getElementById('pause')!.onclick=()=>{paused=!paused;document.getElementById('pause')!.textContent=paused?'재생':'일시정지';};
const entries=definitions.map(([kind,title,description,color])=>{
 const card=document.createElement('section');card.className='card';
 card.innerHTML=`<div class="view" aria-label="${title} 3D 미리보기"></div><div class="caption"><h2>${title}</h2><p>${description}</p></div>`;
 document.getElementById('gallery')!.append(card);const host=card.querySelector<HTMLElement>('.view')!;
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.append(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,100);camera.position.set(5,1.8,4.3);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableZoom=false;controls.enablePan=false;
 const visual=new PlasmoidVisual(kind);scene.add(visual);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshBasicMaterial({color:0xb4c6cd}));ground.rotation.x=-Math.PI/2;ground.position.y=-2;scene.add(ground);
 const grid=new THREE.GridHelper(100,50,0x849ca9,0x9eafb8);grid.position.y=-1.99;scene.add(grid);
 const resize=new ResizeObserver(()=>{renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();});resize.observe(host);
 return {renderer,scene,camera,controls,visual,ground,grid,resize,color};
});
function refresh(){for(const e of entries){const night=select('light').value==='night';e.scene.background=new THREE.Color(night?0x07111f:0xc5dfec);e.ground.material.color.set(night?0x101c2b:0xb4c6cd);e.grid.visible=!night;e.visual.setLighting(night?0:1);e.visual.setDistance(select('distance').value==='far'?100:0);e.visual.setColor(select('color').value==='shared'?'#62cfff':e.color);e.camera.position.setLength(select('distance').value==='far'?20:6.9);e.controls.update();}}
for(const id of ['light','distance','color'])select(id).onchange=refresh;refresh();
const clock=new THREE.Clock();let frame=0;
function render(){const dt=Math.min(clock.getDelta(),.05);if(!paused)time+=dt;for(const e of entries){e.visual.update(time,select('pose').value as PlasmoidPose);e.renderer.render(e.scene,e.camera);}frame=requestAnimationFrame(render);}render();
window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);for(const e of entries){e.resize.disconnect();e.controls.dispose();e.visual.dispose();e.ground.geometry.dispose();e.ground.material.dispose();e.grid.geometry.dispose();(e.grid.material as THREE.Material).dispose();e.renderer.dispose();}},{once:true});
