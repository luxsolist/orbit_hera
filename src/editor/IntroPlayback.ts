import * as THREE from 'three';
import {CinematicPlayer} from '../intro/CinematicPlayer';
import {introScenes} from '../intro/scenes';
import {prepareSeoulStreet} from '../intro/SeoulStreet';
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;document.body.append(renderer.domElement);
let player:CinematicPlayer|undefined,dead=false;const button=document.getElementById('start') as HTMLButtonElement;
button.onclick=async()=>{button.disabled=true;button.textContent='서울 장면 불러오는 중…';try{await prepareSeoulStreet();if(dead)return;player?.dispose();player=new CinematicPlayer(renderer,introScenes());button.hidden=true;}catch(e){button.textContent=String(e);}finally{button.disabled=false;}};
const clock=new THREE.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());player?.update(dt);if(player?.done){button.hidden=false;button.textContent='인트로 다시 재생';player=undefined;}});
window.addEventListener('pagehide',()=>{dead=true;renderer.setAnimationLoop(null);player?.dispose();renderer.dispose();},{once:true});
