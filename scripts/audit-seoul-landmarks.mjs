// Read-only audit of current runtime-corrected Seoul geometry. No real-world accuracy certification.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const source=(await json('scripts/data/landmark-catalog.json')).cities['서울'];
const legacy=await json('public/maps/landmarks.json');
const targets=[...source.map(l=>({...l,kind:'대표'})),...Object.entries(legacy).map(([name,l])=>({...l,name,kind:'세부'}))];
const m=await json('public/maps/37/126/tiles.json'),C=m.chunkSize,R=500;
const known=new Set(m.chunks.map(c=>`${c.cx}_${c.cz}`));
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
const {correctJamsilChunk}=await server.ssrLoadModule('/src/world/cities/jamsilCorrection.ts');
const {chunkTerrainEntry,sampleChunkHeight,buildingGroundRange}=await server.ssrLoadModule('/src/world/chunkMesh.ts');
const cache=new Map();
async function chunk(cx,cz){const key=`${cx}_${cz}`;if(cache.has(key))return cache.get(key);let result=null;try{const raw=await json(`public/maps/37/126/${Math.floor(cx/m.block)}_${Math.floor(cz/m.block)}/${key}.json`);const c=correctJamsilChunk(m.cell,raw,C);result={c,t:chunkTerrainEntry(c,C)};}catch{}cache.set(key,result);return result;}
function segDist(x,z,a,b,c,d){const dx=c-a,dz=d-b,len=dx*dx+dz*dz,u=len?Math.max(0,Math.min(1,((x-a)*dx+(z-b)*dz)/len)):0;return Math.hypot(x-a-u*dx,z-b-u*dz);}
function ringDist(x,z,p){let inside=false,d=Infinity;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])inside=!inside;d=Math.min(d,segDist(x,z,p[j],p[j+1],p[i],p[i+1]));}return inside?0:d;}
const area=p=>{let a=0;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)a+=p[j]*p[i+1]-p[i]*p[j+1];return Math.abs(a)/2;};
const results=[];
for(const l of targets){
 const x=(l.lon-m.originLon)*m.mLon,z=(m.originLat-l.lat)*111320;
 const out={name:l.name,kind:l.kind,lat:l.lat,lon:l.lon,chunks:0,missing:[],buildings:0,smallTall:[],roofAdjusted:0,maxRoofLift:0,terrainMin:Infinity,terrainMax:-Infinity,roadSamples:0,steepSamples:0,maxGrade:0,heightSource:'unavailable',visualVerified:false,realMatch:'未検証'};
 const seen=new Set();
 for(let cz=Math.floor((z-R)/C);cz<=Math.floor((z+R)/C);cz++)for(let cx=Math.floor((x-R)/C);cx<=Math.floor((x+R)/C);cx++){
  if(Math.hypot(Math.max(cx*C-x,0,x-(cx+1)*C),Math.max(cz*C-z,0,z-(cz+1)*C))>R)continue;
  out.chunks++;const key=`${cx}_${cz}`,entry=known.has(key)?await chunk(cx,cz):null;if(!entry){out.missing.push(key);continue;}const {c,t}=entry;
  for(const b of c.objects.buildings){if(b.p.length<6||ringDist(x,z,b.p)>R)continue;const sig=JSON.stringify(b.p);if(seen.has(sig))continue;seen.add(sig);out.buildings++;const a=area(b.p);
   const px=b.p.filter((_,i)=>i%2===0),pz=b.p.filter((_,i)=>i%2===1),bx=px.reduce((a,v)=>a+v,0)/px.length,bz=pz.reduce((a,v)=>a+v,0)/pz.length,h=b.h??9;
   if(a<200&&h>45)out.smallTall.push({chunk:key,area:Math.round(a),height:h,lat:m.originLat-bz/111320,lon:m.originLon+bx/m.mLon});
   const gr=buildingGroundRange(t,b.p),lift=Math.max(0,gr.max+Math.min(h,2.8)-sampleChunkHeight(t,bx,bz)-h);if(lift>.01){out.roofAdjusted++;out.maxRoofLift=Math.max(out.maxRoofLift,lift);}
  }
  if(t)for(let j=0;j<t.size;j++)for(let i=0;i<t.size;i++){if(Math.hypot(t.cellX0+i*t.step-x,t.cellZ0+j*t.step-z)<=R){const h=t.heights[j*t.size+i];out.terrainMin=Math.min(out.terrainMin,h);out.terrainMax=Math.max(out.terrainMax,h);}}
  for(const road of c.objects.roads)for(let i=2;i<road.p.length;i+=2){const [ax,az,bx,bz]=road.p.slice(i-2,i+2),len=Math.hypot(bx-ax,bz-az),n=Math.ceil(len/8);if(!n||segDist(x,z,ax,az,bx,bz)>R)continue;
   for(let k=0;k<n;k++){const u=k/n,v=(k+1)/n,xx=ax+(bx-ax)*(u+v)/2,zz=az+(bz-az)*(u+v)/2;if(Math.hypot(xx-x,zz-z)>R)continue;const grade=Math.abs(sampleChunkHeight(t,ax+(bx-ax)*v,az+(bz-az)*v)-sampleChunkHeight(t,ax+(bx-ax)*u,az+(bz-az)*u))/(len/n);out.roadSamples++;if(grade>.12)out.steepSamples++;out.maxGrade=Math.max(out.maxGrade,grade);}
  }
 }
 out.note=l.geocodeSource?.displayName?.includes('Viewpoint of the N Seoul Tower')?'타워가 아닌 전망 지점 좌표':l.name==='청계천'?'선형 명소의 한 구간; 청계광장 기준 아님':l.name==='한양도성'?'성곽 한 구간; 도성 전체 검증 아님':'';
 out.realMatch=out.note.includes('타워가 아닌')?'기준 위치 오류':'실측 대조 미완료';
 results.push(out);
}
await mkdir('build',{recursive:true});await writeFile('build/seoul-landmark-audit.json',JSON.stringify({radiusM:R,targets:results,definitions:{smallTall:'footprint<200m² and height>45m: review candidate, not proven error',steep:'absolute road grade>12% sampled at <=8m: review candidate, not engineering limit',coverage:'circle-intersecting chunks',counts:'overlapping landmark areas must not be summed as unique buildings'}},null,2));
let md='# 서울 랜드마크 반경 500m 검증 결과\n\n';
md+='검사일: '+new Date().toISOString().slice(0,10)+'. 대표 26곳 + 기존 세부 11곳. 현재 런타임 잠실 보정까지 적용한 데이터를 분석했다. 게임/지도 데이터는 수정하지 않았다.\n\n**실제와 동일하다고 판정한 지점은 없다.** 데이터 검사는 완료했지만 전 건물의 최신 실측 높이, 도로 측량, 모든 시점의 사진 대조가 확보되지 않았다. 지도 파일 존재는 현실 정확도와 다르다.\n\n';
md+='| 지점 | 타일 누락 | 건물 수 | 작은 고층 후보 | 지붕 보정 수 | 지형 범위(m) | 도로 급경사 표본 | 비고 |\n|---|---:|---:|---:|---:|---|---:|---|\n';
for(const a of results)md+=`| ${a.name} | ${a.missing.length}/${a.chunks} | ${a.buildings} | ${a.smallTall.length} | ${a.roofAdjusted} | ${a.terrainMin.toFixed(1)}–${a.terrainMax.toFixed(1)} | ${a.steepSamples}/${a.roadSamples} | ${a.note||'실측 대조 미완료'} |\n`;
md+='\n## 판독 기준과 한계\n- 작은 고층 후보: 바닥 면적 200㎡ 미만이면서 높이 45m 초과. 실제 소형 타워/종탑도 포함하므로 오류 확정이 아니다.\n- 도로 급경사: 중심선 8m 이하 간격의 지형 고도차가 수평거리의 12% 초과. 산길의 정상 경사도 포함한다. 12%는 탐색 기준이며 법정/설계 기준이 아니다.\n- 지붕 보정: 기존 중심지면+높이보다 렌더 지붕을 높인 수. DEM 요철 또는 실제 경사에 대한 기하학 보정이며 실측 건물 높이가 아니다.\n- 지형 범위는 500m 원 내부 격자 표본이다. 최대 기울기는 표본 기반이며 실제 도로 종단 측량이 아니다.\n- 서로 겹치는 반경의 건물은 중복 집계되므로 행별 수를 서울 고유 건물 수로 합산하지 않는다.\n- 런타임 타일은 OSM 원본 ID/높이 추정 여부/층수/수집시각을 보존하지 않아 건물별 정확도 자동 인증이 불가능하다.\n- 공통 외벽·창문·평평한 지붕을 쓰므로 궁궐/성문/한옥의 고유 형태와 실제 재질 재현은 미완료다.\n- 현재 지형은 1024m당 33점(32m 간격), 교량 층위/도로 종단 측량이 없으며, 잠실은 추정 평탄화이다.\n\n상세 좌표·후보 목록: build/seoul-landmark-audit.json. 재실행: node scripts/audit-seoul-landmarks.mjs.\n';
await writeFile('docs/seoul-landmark-audit.md',md);console.log(JSON.stringify(results.map(a=>({name:a.name,missing:a.missing.length,buildings:a.buildings,smallTall:a.smallTall.length,steep:a.steepSamples,roadSamples:a.roadSamples,roof:a.roofAdjusted,note:a.note})),null,2));
}finally{await server.close();}
