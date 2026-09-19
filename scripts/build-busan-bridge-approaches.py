"""Build source-road-aligned bridge approaches after build-busan-coast.py.
Horizontal alignment is OSM; vertical profiles fit the runtime DEM (not a survey).
"""
from pathlib import Path
import json, math, heapq, xml.etree.ElementTree as E
from collections import defaultdict
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
ROOT=Path('public/maps/details/busan'); IP=Path('src/world/cities/busan-detail-index.json')
idx=json.loads(IP.read_text()); M=111320*math.cos(math.radians(35.5)); ns={}; ws={}
files=[Path(t['file']) for t in idx['targets']]+sorted(Path('build/busan-reference').glob('bridge-corridor-*.osm'))
for f in files:
 for e in E.parse(f).getroot():
  if e.tag=='node':ns[e.get('id')]=((float(e.get('lon'))-129)*M,(36-float(e.get('lat')))*111320)
  elif e.tag=='way':ws[e.get('id')]=e
G=defaultdict(list); tags={}
for wid,w in ws.items():
 t={e.get('k'):e.get('v') for e in w.findall('tag')}; refs=[e.get('ref') for e in w.findall('nd')]
 if t.get('highway') not in ['trunk','trunk_link','primary','secondary'] or not all(r in ns for r in refs):continue
 tags[wid]=t
 for a,b in zip(refs,refs[1:]):
  d=math.dist(ns[a],ns[b]); G[a].append((b,d,wid));G[b].append((a,d,wid))
patch={k:json.loads((ROOT/(k+'.json')).read_text()) for k in idx['chunks']}; raw={}
def chunk(k):
 if k not in raw:
  x,z=map(int,k.split('_'));raw[k]=json.loads(Path(f'public/maps/35/129/{x//16}_{z//16}/{k}.json').read_text())
 return raw[k]
def ensure(k):
 chunk(k)
 if k not in patch:patch[k]={n:[] for n in ['buildings','areas','water','paths','walls','trees','terrain']}
 return patch[k]
for d in patch.values():d['bridgeApproaches']=[]
def height(x,z):
 k=f'{int(x//1024)}_{int(z//1024)}';c=chunk(k);t=c['terrain'];n=t['size'];h=t['heights'].copy()
 for i,y in patch.get(k,{}).get('terrain',[]):h[i]=y
 gp=Path('public/maps/road-grade/35/129')/(k+'.json')
 if gp.exists():
  g=json.loads(gp.read_text());pts=g.get('points',[])
  if all(abs(h[i]-old)<.01 or abs(h[i]-new)<.01 for i,old,new in pts):
   for i,old,new in pts:h[i]=new
 fx=(x-c['cx']*1024)*(n-1)/1024;fz=(z-c['cz']*1024)*(n-1)/1024;ix=min(n-2,int(fx));iz=min(n-2,int(fz));fx-=ix;fz-=iz
 a=h[iz*n+ix];b=h[iz*n+ix+1];cc=h[(iz+1)*n+ix];d=h[(iz+1)*n+ix+1]
 return a+(b-a)*fx+(cc-a)*fz if fx+fz<=1 else d+(cc-d)*(1-fx)+(b-d)*(1-fz)
def isbridge(w):return tags[w].get('bridge','no')!='no'
def trace(start,blocked,direction):
 q=[(0,start,[])];seen=set()
 while q:
  dist,u,path=heapq.heappop(q)
  if u in seen:continue
  seen.add(u)
  if path and any(not isbridge(w) for v,d,w in G[u]):return [start]+[v for v,w in path],[w for v,w in path]
  for v,d,w in G[u]:
   if w in blocked or not isbridge(w):continue
   if not path and sum((ns[v][i]-ns[u][i])*direction[i] for i in [0,1])<0:continue
   heapq.heappush(q,(dist+d,v,path+[(v,w)]))
 raise ValueError(('No mapped ground connection',start))
routes=[]
for owner,d in list(patch.items()):
 for b in d.get('bridges',[]):
  gw=b['tower']>0
  for level in ([2,1] if gw else [1]):
   central='580959059' if gw and level==2 else '580959066' if gw else '117608555'
   refs=[e.get('ref') for e in ws[central].findall('nd')]
   for side in [-1,1]:
    direction=(math.cos(b['angle'])*side,math.sin(b['angle'])*side);end=(b['x']+direction[0]*b['length']/2,b['z']+direction[1]*b['length']/2)
    start=min([refs[0],refs[-1]],key=lambda r:math.dist(ns[r],end))
    # Yeongdo's mapped bridge ends directly at ground; Gwangan follows elevated roads to shore.
    ids,wids=([start],[]) if not gw else trace(start,{'580959059','580959066'},direction)
    prev=ns[ids[-2]] if len(ids)>1 else (end[0]-direction[0]*10,end[1]-direction[1]*10)
    u=ids[-1];extra=0;visited=set(ids)
    while extra<160:
     dx,dz=ns[u][0]-prev[0],ns[u][1]-prev[1];norm=math.hypot(dx,dz)
     opts=[(sum((ns[v][i]-ns[u][i])*(dx,dz)[i] for i in [0,1])/max(.001,dist*norm),v,dist,w) for v,dist,w in G[u] if v not in visited and not isbridge(w)]
     if not opts:break
     score,v,dist,w=max(opts)
     if score<-.2:break
     prev=ns[u];u=v;visited.add(u);ids.append(u);wids.append(w);extra+=dist
    points=[end]+[ns[r] for r in ids if sum((ns[r][i]-end[i])*direction[i] for i in [0,1])>2]
    if len(points)<2:raise ValueError('Empty approach')
    line=LineString(points);length=line.length
    routes.append(dict(id=b['id']+f'/{level}/{side}',bridge=b,level=level,side=side,line=line,length=length,ways=list(dict.fromkeys(wids))))

# Snap the final landing onto the actual baked road, not only the newer OSM line.
for r in routes:
 end=Point(r['line'].coords[-1]);cx=int(end.x//1024);cz=int(end.y//1024);candidates=[]
 for x in range(cx-1,cx+2):
  for z in range(cz-1,cz+2):
   try:c=chunk(f'{x}_{z}')
   except FileNotFoundError:continue
   for road in c['objects']['roads']:
    l=LineString(list(zip(road['p'][::2],road['p'][1::2])))
    if l.distance(end)<20:candidates.append((l.distance(end),l,road))
 if not candidates:raise ValueError(('No baked road at landing',r['id']))
 _,line,road=min(candidates,key=lambda a:a[0]);q=line.interpolate(line.project(end));points=list(r['line'].coords);points[-1]=(q.x,q.y);r['line']=LineString(points);r['length']=r['line'].length;r['landingWidth']=road.get('w',6)
# Per-segment ownership avoids unloading the entire approach with the central span tile.
audit=[]
for r in routes:
 line=r['line'];L=line.length;b=r['bridge'];Y=b['deck']-(8 if b['tower'] and r['level']==1 else 0)+.08
 end=line.interpolate(L);target=height(end.x,end.y)+.025;count=math.ceil(L/12);sections=[]
 for i in range(count+1):
  s=L*i/count;p=line.interpolate(s);a=line.interpolate(max(0,s-2));bb=line.interpolate(min(L,s+2));dx,dz=bb.x-a.x,bb.y-a.y;n=math.hypot(dx,dz)
  if i==0:dx,dz=math.cos(b['angle'])*r['side'],math.sin(b['angle'])*r['side'];n=1
  t=s/L;blend=t*t*(3-2*t);y=Y+(target-Y)*blend
  width=b['width']+(min(18,b['width'])-b['width'])*min(1,s/100)
  taper=max(0,min(1,(s-(L-100))/100));width=width*(1-taper)+r['landingWidth']*taper
  lx,lz=p.x-dz/n*width/2,p.y+dx/n*width/2;rx,rz=p.x+dz/n*width/2,p.y-dx/n*width/2
  # Last 60m conform to the same triangle DEM used by StreetGeometry.
  fit=max(0,min(1,(s-(L-60))/60));fit=fit*fit*(3-2*fit)
  ly=y*(1-fit)+(height(lx,lz)+.025)*fit;ry=y*(1-fit)+(height(rx,rz)+.025)*fit
  sections.append([round(v,4) for v in [lx,ly,lz,rx,ry,rz]])
 for i,(a,bsec) in enumerate(zip(sections,sections[1:])):
  x=(a[0]+a[3]+bsec[0]+bsec[3])/4;z=(a[2]+a[5]+bsec[2]+bsec[5])/4;k=f'{int(x//1024)}_{int(z//1024)}'
  ensure(k).setdefault('bridgeApproaches',[]).append(dict(id=r['id'],segment=i,a=a,b=bsec,distance=round(L*i/count,4),rail=round(min(1,(L-L*i/count)/40),3),supportBase=round(max(0,height(x,z)),3) if i%5==2 else None))
 audit.append(dict(id=r['id'],sourceWays=r['ways'],length=round(L,2),sections=len(sections),start=sections[0],landing=sections[-1],landingCenter=[end.x,end.y],landingHeight=target,landingWidth=r['landingWidth'],maxGrade=max(abs((b[1]+b[4]-a[1]-a[4])/2)/(L/count) for a,b in zip(sections,sections[1:]))))
# Cut only longitudinal roads inside the original bridge footprint. Cross streets must survive.
for k,d in patch.items():
 replacements=[]
 for rep in d.get('roadReplacements',[]):
  pts=list(zip(rep['p'][::2],rep['p'][1::2]));mid=Point(pts[len(pts)//2]);near=min(routes,key=lambda r:r['line'].distance(mid));angle=near['bridge']['angle'];dx=pts[-1][0]-pts[0][0];dz=pts[-1][1]-pts[0][1]
  if abs(dx*math.cos(angle)+dz*math.sin(angle))/max(.001,math.hypot(dx,dz))>.8:replacements.append(rep)
 # Old baked maps flatten elevated carriageways onto the sea/ground. Remove only
 # aligned segments within 8m of a source bridge way, leaving crossing roads intact.
 elevated=[]
 for r in routes:
  for wid in r['ways']:
   if not isbridge(wid):continue
   pts=[ns[e.get('ref')] for e in ws[wid].findall('nd')]
   cx,cz=map(int,k.split('_'))
   elevated.extend((LineString([a,b]),a,b) for a,b in zip(pts,pts[1:]) if math.dist(a,b)>0 and max(a[0],b[0])>=cx*1024-8 and min(a[0],b[0])<=(cx+1)*1024+8 and max(a[1],b[1])>=cz*1024-8 and min(a[1],b[1])<=(cz+1)*1024+8)
 previous={json.dumps(r['p']):r['pieces'] for r in replacements}
 replacements=[]
 for road in chunk(k)['objects']['roads']:
  chains=previous.get(json.dumps(road['p']),[road['p']]);pieces=[];changed=json.dumps(road['p']) in previous
  for chain in chains:
   coords=list(zip(chain[::2],chain[1::2]));line=LineString(coords);cuts=[]
   for a,b in zip(coords,coords[1:]):
    dx,dz=b[0]-a[0],b[1]-a[1];norm=math.hypot(dx,dz)
    if norm<.01:continue
    seg=LineString([a,b])
    for el,ea,eb in elevated:
     ex,ez=eb[0]-ea[0],eb[1]-ea[1]
     if abs(dx*ex+dz*ez)/(norm*el.length)<.9 or seg.distance(el)>8:continue
     cuts.append(el.buffer(8,cap_style=2))
   if cuts:
    changed=True;remain=line.difference(unary_union(cuts));parts=[remain] if remain.geom_type=='LineString' else list(remain.geoms) if hasattr(remain,'geoms') else []
    pieces.extend([[round(v,3) for q in seg.coords for v in q] for seg in parts if seg.geom_type=='LineString' and seg.length>1])
   else:pieces.append(chain)
  if changed:replacements.append(dict(p=road['p'],pieces=pieces))
 d['roadReplacements']=replacements
 (ROOT/(k+'.json')).write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
idx['bridgeCorridorSources']=json.loads(Path('build/busan-reference/bridge-corridor-index.json').read_text());idx['chunks']=sorted(patch);idx['bridgeApproaches']=dict(routes=len(routes),segments=sum(len(d['bridgeApproaches']) for d in patch.values()),source='OSM connected road ways; DEM-fitted estimated vertical profile')
IP.write_text(json.dumps(idx,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'bridge-approach-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
for a in audit:print(a['id'],a['length'],'grade',round(a['maxGrade'],3))
