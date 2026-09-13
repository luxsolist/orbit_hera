// Architectural interpretation, not a measured restoration model.
// Sources and approximation boundaries: docs/gyeongbokgung-models.md.
const palette=['c6c2b6','b3afa2','873f32','356d58','46545d','424e56','505d65','28312f','aa936c','c7c2aa'];
const mats=palette.map(c=>({c,rough:.92,flat:false}));
export const koreanRoofProfiles={
 throne:{form:'paljak',ridge:.66,cornerLift:.30,curve:.57,tileSpacing:.52},
 gate:{form:'ujingak',ridge:.60,cornerLift:.24,curve:.49,tileSpacing:.50},
 pavilion:{form:'paljak',ridge:.64,cornerLift:.34,curve:.55,tileSpacing:.54},
};
function kit(profile){
 const parts=[];
 const box=(s,p,m=0)=>parts.push({g:'box',s,p,m});
 const col=(x,z,y,h,r=.34,m=2,square=false)=>square?box([r*2,h,r*2],[x,y+h/2,z],m):parts.push({g:'cyl',rt:r*.91,rb:r,h,seg:12,p:[x,y+h/2,z],m});
 const rail=(w,d,y,m=0)=>{for(const z of [-d,d]){box([w*2,.16,.18],[0,y+.75,z],m);for(let x=-w;x<=w+.01;x+=2)box([.2,.95,.2],[x,y+.48,z],m);}for(const x of [-w,w]){box([.18,.16,d*2],[x,y+.75,0],m);for(let z=-d;z<=d+.01;z+=2)box([.2,.95,.2],[x,y+.48,z],m);}};
 const steps=(w,z,y,count)=>{for(let i=0;i<count;i++)box([w,(i+1)*y/count,.48],[0,(i+1)*y/count/2,z-i*.45],i%3===0?1:0);};
 function roof(W,D,H,y){
  const groups=[[],[],[]],R=W*profile.ridge,cut=.52,paljak=profile.form==='paljak';
  const faces=[ [[-W,D],[W,D],[-R,0],[R,0]], [[W,-D],[-W,-D],[R,0],[-R,0]], [[W,D],[W,-D],[R,0],[R,0]], [[-W,-D],[-W,D],[-R,0],[-R,0]] ];
  for(const [faceIndex,[a,b,c,d]] of faces.entries()){
   const columns=Math.max(8,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/profile.tileSpacing)),rows=6;
   const point=(u,t)=>{const ex=a[0]+(b[0]-a[0])*u,ez=a[1]+(b[1]-a[1])*u,rx=c[0]+(d[0]-c[0])*u,rz=c[1]+(d[1]-c[1])*u;const tx=paljak?Math.min(t/cut,1):t;
    const lift=profile.cornerLift*Math.pow(Math.abs(u*2-1),4)*(1-t);
    return [ex+(rx-ex)*tx,y+H*((1-profile.curve)*t+profile.curve*t*t)+lift,ez+(rz-ez)*t];};
   for(let i=0;i<columns;i++)for(let j=0;j<rows;j++){
    const end=paljak&&faceIndex>=2?cut:1;
    const A=point(i/columns,j/rows*end),B=point((i+1)/columns,j/rows*end),C=point((i+1)/columns,(j+1)/rows*end),D=point(i/columns,(j+1)/rows*end);
    const arr=groups[i%7===0?2:i%2];
    for(const tri of [[A,B,C],[A,C,D]]){
     const [a,b,c]=tri;const ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
     const q=ny>=0?tri:[a,c,b];arr.push(...q.flat());arr.push(...[...q].reverse().flatMap(p=>[p[0],p[1]-.14,p[2]]));
    }
   }
  }
  if(paljak){
   // Hapgak side walls end at the upper roof slopes; no gable on Gwanghwamun.
   const z=D*(1-cut),base=y+H*((1-profile.curve)*cut+profile.curve*cut*cut)+profile.cornerLift*(1-cut);
   for(const sx of [-1,1]){
    const x=sx*R,outline=[];
    for(const sz of [-1,1])for(let j=0;j<=8;j++){
     const t=cut+(1-cut)*(sz===-1?j/8:1-j/8);
     outline.push([x,y+H*((1-profile.curve)*t+profile.curve*t*t)+profile.cornerLift*(1-t),sz*D*(1-t)]);
    }
    const vertices=[];
    for(let j=0;j<outline.length-1;j++){
     const a=[x,base,0],b=outline[j],c=outline[j+1];vertices.push(...a,...b,...c,...a,...c,...b);
     parts.push({g:'strut',a:[x+sx*.07,b[1],b[2]],b:[x+sx*.07,c[1],c[2]],thick:.14,m:2});
    }
    parts.push({g:'mesh',vertices,m:9});
    for(let row=0;row<4;row++){const t=(row+1)/5;box([.13,.06,1.5*z*(1-t)],[x+sx*.08,base+(y+H-base)*t,0],2);}
   }
  }

  groups.forEach((vertices,i)=>parts.push({g:'mesh',vertices,m:4+i}));
  // Two rafter rows and round end tiles: silhouette detail, not painted stripes.
  for(const [a,b] of faces){
   const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=dz/length,nz=-dx/length;
   const n=Math.ceil(length/(profile.tileSpacing*2));
   for(let i=0;i<n;i++){
    const u=(i+.5)/n,x=a[0]+dx*u,z=a[1]+dz*u,lift=profile.cornerLift*Math.pow(Math.abs(u*2-1),4);
    for(let row=0;row<2;row++)parts.push({g:'strut',a:[x-nx*.9,y-.22-row*.16+lift,z-nz*.9],b:[x+nx*(row?-.16:.03),y-.22-row*.16+lift,z+nz*(row?-.16:.03)],thick:row?.10:.13,m:row?8:3});
    parts.push({g:'cyl',rt:.105,rb:.105,h:.12,seg:6,rx:Math.PI/2,ry:Math.atan2(nx,nz),p:[x,y+.035+lift,z],m:6});
   }
  }

  box([R*2+.6,.30,.45],[0,y+H+.10,0],5);
  for(const side of [-1,1])box([.25,.55,.34],[side*(R+.12),y+H+.27,0],5);
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const end=paljak?cut:1;
   const p=t=>[sx*(W+(R-W)*(paljak?Math.min(t/cut,1):t)),y+H*((1-profile.curve)*t+profile.curve*t*t)+profile.cornerLift*(1-t)+.10,sz*D*(1-t)];
   for(let j=0;j<10;j++)parts.push({g:'strut',a:p(j/10*end),b:p((j+1)/10*end),thick:.20,m:5});
   // Simplified silhouettes, deliberately not a claim of surveyed japsang count.
   for(let j=0;j<5;j++){const a=p(.05+j*.047);box([.14,.23+j*.018,.14],[a[0],a[1]+.13,a[2]],5);}
  }

 }
 function hall(w,d,y,h,nx,nz,{open=false}={}){
  if(!open)box([w*2-.6,h-.3,d*2-.6],[0,y+h/2,0],7);
  for(let ix=0;ix<=nx;ix++)for(let iz=0;iz<=nz;iz++)if(ix===0||ix===nx||iz===0||iz===nz){
   const x=-w+ix*w*2/nx,z=-d+iz*d*2/nz;col(x,z,y,h,.32);box([.85,.22,.85],[x,y+.11,z],1);
   for(let level=0;level<3;level++){box([.85+level*.26,.17,.42],[x,y+h-.7+level*.22,z],level===1?8:3);box([.42,.17,.85+level*.26],[x,y+h-.7+level*.22,z],3);}
  }
  for(const z of [-d,d]){
   box([w*2+.7,.35,.5],[0,y+h-.15,z],3);box([w*2+.8,.12,.56],[0,y+h+.07,z],8);
   if(!open)for(let bay=0;bay<nx;bay++){const bw=w*2/nx,x=-w+(bay+.5)*bw;box([bw-.55,h*.64,.15],[x,y+h*.39,z],2);for(let k=1;k<6;k++)box([.055,h*.52,.10],[x-bw*.4+k*bw*.8/6,y+h*.45,z+Math.sign(z)*.11],9);for(let k=0;k<4;k++)box([bw-.7,.055,.10],[x,y+h*(.24+k*.14),z+Math.sign(z)*.11],9);}
  }
  for(const x of [-w,w])box([.5,.35,d*2],[x,y+h-.15,0],3);
 }
 return {parts,box,col,rail,steps,roof,hall};
}
function throne(){
 const k=kit(koreanRoofProfiles.throne);k.box([34,1.3,28],[0,.65,0]);k.box([30,1.3,24],[0,1.95,0]);k.rail(16.2,13.2,1.3);k.rail(14.2,11.2,2.6);k.steps(6,14.5,2.6,9);
 k.hall(12,9.2,2.6,7,5,5);k.roof(14.3,11.4,3.4,10);
 k.hall(10.9,8.1,12.2,3,5,5);k.roof(13,10.2,4.4,15.45);
 return {mats,parts:k.parts};
}
function gate(){
 const k=kit(koreanRoofProfiles.gate),arches=[[-10,2.1],[0,2.65],[10,2.1]],half=19,depth=5.1,top=7.5;
 // Narrow voussoir sections leave genuinely curved openings (visual geometry).
 const step=.24;
 for(let x=-half;x<half;x+=step){
  const mid=x+step/2,a=arches.find(([cx,r])=>Math.abs(mid-cx)<r);
  const bottom=a?3.3+Math.sqrt(Math.max(0,a[1]*a[1]-(mid-a[0])**2)):0;
  k.box([step+.004,top-bottom,depth*2],[mid,(top+bottom)/2,0],Math.floor((x+half)/1.3)%5===0?1:0);
 }
 for(const z of [-depth-.01,depth+.01]){
  for(let y=1;y<7.5;y+=.65)for(let x=-half;x<half;x+=1.8){const mid=x+.88,a=arches.find(([cx,r])=>Math.abs(mid-cx)<r+.9);if(a&&y<6.3)continue;k.box([1.74,.025,.025],[mid,y,z],1);}
  for(const [cx,r] of arches)for(let i=0;i<18;i++){const t=(i+.5)/18*Math.PI;k.box([.42,.56,.2],[cx+Math.cos(t)*(r+.27),3.3+Math.sin(t)*(r+.27),z],i%3===0?1:0);k.parts.at(-1).rz=t-Math.PI/2;}
 }
 k.box([39,.35,11],[0,7.5,0],0);k.hall(15,3.5,7.7,3.8,7,2);k.roof(18,5.8,2.7,11.8);
 k.hall(13.7,3.1,13.1,2.4,7,2);k.roof(16.4,5.2,3.4,15.7);
 return {mats,parts:k.parts};
}
function pavilion(){
 const k=kit(koreanRoofProfiles.pavilion);k.box([33,.5,27],[0,.25,0],0);
 for(let ix=0;ix<8;ix++)for(let iz=0;iz<6;iz++)k.col(-14+ix*4,-11+iz*4.4,.5,5.7,.42,0,ix===0||ix===7||iz===0||iz===5);
 k.box([32,1,26],[0,6.7,0],2);k.rail(15.6,12.6,7.2,2);k.hall(14,11,7.2,4.1,7,5,{open:true});k.roof(18,14.2,4.8,11.65);
 return {mats,parts:k.parts};
}
export const refinedPalaces={'geunjeongjeon':throne,'gwanghwamun':gate,'gyeonghoeru':pavilion};
