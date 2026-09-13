"""Build source-attributed Seoul landmark detail patches. Never infer measured elevations.
Input: scripts/fetch-seoul-reference.py. Runtime footprint matches require bidirectional <=2m.
"""
from pathlib import Path
import json,math,re,statistics,collections,xml.etree.ElementTree as E
BASE=Path('build/seoul-reference'); targets=json.loads((BASE/'index.json').read_text())
if any('error' in t for t in targets):raise ValueError('Incomplete source downloads')
M=88316.0938412203; nodes={};ways={};rels={}
for t in targets:
 for e in E.parse(t['file']).getroot():
  d={'node':nodes,'way':ways,'relation':rels}.get(e.tag)
  if d is not None:d[e.attrib['id']]=e
print('XML loaded',len(nodes),len(ways),len(rels),flush=True)
def tags(e):return {t.get('k'):t.get('v') for t in e.findall('tag')}
def point(n):return [round((float(n.get('lon'))-126)*M,3),round((38-float(n.get('lat')))*111320,3)]
def inside(x,z,p):
 hit=False
 for i in range(0,len(p),2):
  j=(i-2)%len(p)
  if (p[i+1]>z)!=(p[j+1]>z) and x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i]:hit=not hit
 return hit
cent=lambda p:(sum(p[::2])/(len(p)/2),sum(p[1::2])/(len(p)/2))
bounds=lambda p:[min(p[::2]),min(p[1::2]),max(p[::2]),max(p[1::2])]
def numeric(s):return float(s.removesuffix(' m')) if re.fullmatch(r'\d+(?:\.\d+)?(?: m)?',s or '') else None
def dist(x,z,p,closed=True):
 d=1e20
 for i in range(0 if closed else 2,len(p),2):
  j=(i-2)%len(p);dx=p[i]-p[j];dz=p[i+1]-p[j+1];t=max(0,min(1,((x-p[j])*dx+(z-p[j+1])*dz)/(dx*dx+dz*dz or 1)));d=min(d,math.hypot(x-p[j]-t*dx,z-p[j+1]-t*dz))
 return d
for t in targets:t['x']=(t['lon']-126)*M;t['z']=(38-t['lat'])*111320
centers=[(t['x'],t['z']) for t in targets]
def relevant(p):
 a=bounds(p)
 return any(math.hypot(max(a[0]-x,0,x-a[2]),max(a[1]-z,0,z-a[3]))<=500 for x,z in centers)
def wp(w):
 refs=[n.get('ref') for n in w.findall('nd')]
 if any(n not in nodes for n in refs):return []
 return [a for n in refs for a in point(nodes[n])]
def join(r,role):
 refs=[m for m in r.findall('member') if m.get('type')=='way' and (m.get('role') or 'outer')==role]
 if any(m.get('ref') not in ways for m in refs):raise ValueError('incomplete')
 chains=[[n.get('ref') for n in ways[m.get('ref')].findall('nd')] for m in refs];out=[]
 while chains:
  c=chains.pop()
  while c[0]!=c[-1]:
   found=False
   for i,b in enumerate(chains):
    if b[0]==c[-1] or b[-1]==c[-1]:c+=(b if b[0]==c[-1] else b[::-1])[1:];chains.pop(i);found=True;break
   if not found:raise ValueError('unclosed')
  if any(n not in nodes for n in c):raise ValueError('missing node')
  out.append([a for n in c[:-1] for a in point(nodes[n])])
 return out
features=[];members=set();incomplete=[]
for id,r in rels.items():
 t=tags(r)
 if not any(k in t for k in ['building','natural','landuse','leisure','historic']):continue
 try:outer=join(r,'outer');inner=join(r,'inner')
 except ValueError:incomplete.append(id);continue
 for i,p in enumerate(outer):
  if relevant(p):features.append(dict(id='relation/'+id+'/'+str(i),p=p,holes=[h for h in inner if inside(*cent(h),p)],tags=t))
 if outer:members.update(m.get('ref') for m in r.findall('member') if m.get('type')=='way')
for id,w in ways.items():
 t=tags(w)
 if not t or id in members:continue
 p=wp(w)
 if len(p)<4 or not relevant(p):continue
 closed=p[:2]==p[-2:]
 if closed:p=p[:-2]
 features.append(dict(id='way/'+id,p=p,holes=[],tags=t,closed=closed))
# Palace precincts are source boundaries, not arbitrary circles. Protect western-style buildings within them.
precinctNames=['경복궁','창덕궁','창경궁','덕수궁','경희궁','종묘','사직단','조계사','봉은사','동관왕묘','동묘','청와대']
precincts=[f for f in features if f['tags'].get('name') in precinctNames and not f['tags'].get('building') and len(f['p'])>=6 and (f.get('closed',True))]
raw={};grid=collections.defaultdict(list)
for x,z in centers:
 for cx in range(int((x-600)//1024),int((x+600)//1024)+1):
  for cz in range(int((z-600)//1024),int((z+600)//1024)+1):
   key=f'{cx}_{cz}';p=Path(f'public/maps/37/126/{cx//16}_{cz//16}/{key}.json')
   if key not in raw and p.exists():raw[key]=json.loads(p.read_text())
for key,c in raw.items():
 for b in c['objects']['buildings']:
  x,z=cent(b['p']);grid[(int(x//50),int(z//50))].append((key,b))
def match(p):
 x,z=cent(p);box=bounds(p);hits=[]
 for gx in range(int(x//50)-1,int(x//50)+2):
  for gz in range(int(z//50)-1,int(z//50)+2):
   for key,b in grid[gx,gz]:
    q=b['p']
    if max(abs(a-v) for a,v in zip(box,bounds(q)))>=2:continue
    if all(dist(p[i],p[i+1],q)<2 for i in range(0,len(p),2)) and all(dist(q[i],q[i+1],p)<2 for i in range(0,len(q),2)):hits.append((key,b))
 return hits[0] if len(hits)==1 else None
patch={key:dict(buildings=[],remove=[],areas=[],paths=[],walls=[],water=[],trees=[],terrain=[]) for key in raw}
def affected(p):
 a=bounds(p)
 return [key for key,c in raw.items() if a[0]<=(c['cx']+1)*1024 and a[2]>=c['cx']*1024 and a[1]<=(c['cz']+1)*1024 and a[3]>=c['cz']*1024]
def elevation(x,z):
 key=f'{int(x//1024)}_{int(z//1024)}';c=raw.get(key)
 if not c:return None
 n=c['terrain']['size'];hs=c['terrain']['heights']
 if n<2:return None
 u=(x-c['cx']*1024)/1024*(n-1);v=(z-c['cz']*1024)/1024*(n-1);i=min(n-2,int(u));j=min(n-2,int(v));a=u-i;b=v-j
 return hs[j*n+i]*(1-a)*(1-b)+hs[j*n+i+1]*a*(1-b)+hs[(j+1)*n+i]*(1-a)*b+hs[(j+1)*n+i+1]*a*b
special={'인정전':('korean-double',18),'명정전':('korean',12),'중화전':('korean',12),'숭정전':('korean',12),'돈화문':('gate',13),'홍화문':('gate',12),'대한문':('gate-single',10),'숭례문':('stone-gate',22),'흥인지문':('stone-gate',22),'동십자각':('stone-gate-single',12),'정전':('shrine',10),'영녕전':('shrine',9),'명동대성당':('cathedral',45),'명동성당':('cathedral',45),'N서울타워':('n-tower',236.7),'남산서울타워':('n-tower',236.7),'롯데월드타워':('lotte',555),'문화역서울284':('station',24),'서울역 구 역사':('station',24),'석조전':('neoclassical',17),'대온실':('greenhouse',8),'국립중앙박물관':('museum',43.08),'전쟁기념관':('museum',24),'국립현대미술관 서울관':('modern',16),'세종문화회관':('modern',28),'세종문화회관 대극장':('modern',28),'세종문화회관 체임버홀':('modern',16),'세종문화회관 미술관':('modern',12),'국립현대미술관':('modern',16),'국립민속박물관':('pagoda-museum',35)}
rows=[];water=[]
for f in features:
 p=f['p'];t=f['tags'];n=t.get('name:ko',t.get('name',''));x,z=cent(p);near=[a['id'] for a in targets if math.hypot(x-a['x'],z-a['z'])<=500]
 if not near:continue
 # Retain the existing detailed Gyeongbokgung site layer.
 gbg=json.loads(Path('src/world/cities/gyeongbokgung-site.json').read_text())['boundary'] if 'gbg' not in globals() else gbg
 if inside(x,z,gbg) and not ('박물관' in n or '미술관' in n):continue
 if t.get('building') and len(p)>=6 and f.get('closed',True) and t['building'] not in ['no','construction']:
  western=t.get('building:architecture') in ['victorian','neoclassical','modern'] or t.get('building') in ['greenhouse','museum','hospital','school','university','office'] or '박물관' in n or '미술관' in n
  tradition=not western and (t.get('building:architecture') in ['joseon','hanok','traditional','korean'] or t.get('roof:shape') in ['hipped-and-gabled'] or any(inside(x,z,a['p']) for a in precincts))
  kind,h=special.get(n,('korean' if tradition else 'source-roof' if t.get('roof:shape') in ['gabled','hipped','pyramidal','dome'] else '',6 if tradition else None))
  if tradition and any(a['tags'].get('name')=='청와대' and inside(x,z,a['p']) for a in precincts):kind='blue-house'
  if n=='청와대 본관':kind,h='blue-house',15
  if f['id']=='way/229891120':kind,h='museum',45
  source='type-estimate' if h else None
  ht=numeric(t.get('height'));lv=numeric(t.get('building:levels'))
  if ht and ht<830:h=ht;source='osm-height'
  elif lv and lv<200 and (not kind or kind in ['modern','greenhouse']):h=round(lv*3.3,1);source='levels-estimate'
  if kind=='n-tower':h=236.7;source='osm-height'
  if kind=='pagoda-museum':h=35;source='type-estimate'
  hit=match(p)
  rows.append(dict(id=f['id'],name=n,targets=near,kind=kind,matched=bool(hit),heightSource=source))
  if hit:
   key,b=hit
   patch[key]['buildings'].append(dict(id=f['id'],p=b['p'],holes=f['holes'],name=n,h=h,kind=kind,roof=t.get('roof:shape','hipped-and-gabled' if tradition else 'flat'),heightSource=source,heightTag=t.get('height'),levelsTag=t.get('building:levels')))
 if (t.get('natural') in ['wood','scrub','grassland','sand','water'] or t.get('landuse') in ['forest','grass','cemetery'] or t.get('leisure') in ['park','garden','pitch']) and len(p)>=6 and f.get('closed',True):
  kind='water' if t.get('natural')=='water' else 'wood' if t.get('natural')=='wood' or t.get('landuse')=='forest' else 'sand' if t.get('natural')=='sand' else 'grass'
  a=dict(id=f['id'],p=p,holes=f['holes'],kind=kind)
  if kind=='water':
   box=bounds(p);ele=numeric(t.get('ele'));samples=sorted(v for i in range(0,len(p),2) if (v:=elevation(p[i],p[i+1])) is not None)
   if samples and (box[2]-box[0])*(box[3]-box[1])<350000:
    a.update(level=ele if ele is not None else round(samples[len(samples)//4]-.15,2),levelSource='osm-ele' if ele is not None else 'shore-dem-estimate');water.append(a)
  for key in affected(p):patch[key]['water' if kind=='water' else 'areas'].append(a)
 if t.get('highway') in ['footway','pedestrian','path','steps'] and len(p)>=4:
  a=dict(id=f['id'],p=p,width=numeric(t.get('width')) or 2.5,bridge=t.get('bridge') not in [None,'no'],tunnel=t.get('tunnel') not in [None,'no'],surface=t.get('surface','unknown'))
  for key in affected(p):patch[key]['paths'].append(a)
 if t.get('barrier') in ['wall','city_wall'] and len(p)>=4:
  a=dict(id=f['id'],p=p+(p[:2] if f.get('closed') else []),h=numeric(t.get('height')) or (5 if t.get('historic')=='citywalls' else 2.5))
  for key in affected(p):patch[key]['walls'].append(a)
# Multiple nested Lotte relation outers are representations of one physical tower.
for key,d in patch.items():
 towers=[b for b in d['buildings'] if b['kind']=='lotte']
 if towers:
  primary=max(towers,key=lambda b:(bounds(b['p'])[2]-bounds(b['p'])[0])*(bounds(b['p'])[3]-bounds(b['p'])[1]))
  candidates=[b for b in raw[key]['objects']['buildings'] if b.get('h')==555 and math.hypot(cent(b['p'])[0]-97382,cent(b['p'])[1]-54264)<100]
  if candidates:
   def area(p):return abs(sum(p[i-2]*p[i+1]-p[i]*p[i-1] for i in range(0,len(p),2)))/2
   reviewed=max(candidates,key=lambda b:area(b['p']))
   primary['p']=reviewed['p'];primary['matchMethod']='reviewed-jamsil-outline'

  d['remove'] += [b['p'] for b in towers if b is not primary]
  d['buildings']=[b for b in d['buildings'] if b['kind']!='lotte' or b is primary]
 for b in d['buildings']:
  if b['kind']=='n-tower':b['modelFootprint']=wp(ways['370286010'])[:-2];b['heightTag']='236.7'
for id,e in nodes.items():
 if tags(e).get('natural')!='tree':continue
 x,z=point(e);key=f'{int(x//1024)}_{int(z//1024)}'
 if key in patch and any(math.hypot(x-a,z-b)<=500 for a,b in centers) and not inside(x,z,gbg):patch[key]['trees'].append([x,z])
# A compound silhouette replaces its nested source sub-footprints (e.g. gate stairs/roof outlines).
# Containment is geometric, never a blanket distance-based building deletion; courtyard holes stay protected.
for key,d in patch.items():
 primaries=[b for b in d['buildings'] if b['kind'] in ['stone-gate','stone-gate-single','n-tower','lotte','cathedral','station','museum','pagoda-museum']]
 removed={json.dumps(p) for p in d['remove']}
 for parent in primaries:
  for b in raw[key]['objects']['buildings']:
   p=b['p']
   if p==parent['p'] or len(p)<6:continue
   if all(inside(p[i],p[i+1],parent['p']) or dist(p[i],p[i+1],parent['p'])<1.5 for i in range(0,len(p),2)) and not any(inside(*cent(p),hole) for hole in parent['holes']):
    sig=json.dumps(p)
    if sig not in removed:d['remove'].append(p);removed.add(sig)
 d['buildings']=[b for b in d['buildings'] if json.dumps(b['p']) not in removed]
# Palace forecourts and mapped pedestrian squares; woodland polygons remain above the precinct ground base.
for f in precincts:
 name=f['tags'].get('name')
 if name not in ['창덕궁','창경궁','덕수궁','경희궁','종묘','사직단']:continue
 for key in affected(f['p']):patch[key]['areas'].insert(0,dict(id=f['id'],p=f['p'],holes=f['holes'],kind='sand'))
for f in features:
 t=f['tags'];p=f['p']
 if not f.get('closed',True) or len(p)<6:continue
 if t.get('place')=='square' or (t.get('highway')=='pedestrian' and t.get('area')=='yes'):
  if inside(*cent(p),gbg):continue
  for key in affected(p):patch[key]['areas'].append(dict(id=f['id'],p=p,holes=f['holes'],kind='paving'))
# Trees in mapped woodland are procedural stand-ins, never individual-tree survey claims.
for key,d in patch.items():
 cx,cz=map(int,key.split('_'));woods=[a for a in d['areas'] if a['kind']=='wood']
 if not woods:continue
 for gx in range(cx*1024+9,(cx+1)*1024,18):
  for gz in range(cz*1024+9,(cz+1)*1024,18):
   x=round(gx+math.sin(gx*.71+gz*.13)*4,2);z=round(gz+math.cos(gx*.17-gz*.39)*4,2)
   if not any(math.hypot(x-a,z-b)<500 for a,b in centers) or inside(x,z,gbg):continue
   if not any(inside(x,z,a['p']) and not any(inside(x,z,h) for h in a['holes']) for a in woods):continue
   nearby=[b for dx in [-1,0,1] for dz in [-1,0,1] for _,b in grid[int(x//50)+dx,int(z//50)+dz]]
   if any(inside(x,z,b['p']) or dist(x,z,b['p'])<5 for b in nearby):continue
   if any(inside(x,z,a['p']) and not any(inside(x,z,h) for h in a['holes']) for a in d['water']):continue
   if any(dist(x,z,a['p'],False)<a['width']/2+4 for a in d['paths']):continue
   if any(math.hypot(x-a,z-b)<8 for a,b in d['trees']):continue
   d['trees'].append([x,z])
# Local water beds only. No flattening of mountains, bridge decks or unsurveyed city streets.
for key,c in raw.items():
 n=c['terrain']['size'];hs=c['terrain']['heights']
 for j in range(n):
  for i in range(n):
   x=c['cx']*1024+i*1024/(n-1);z=c['cz']*1024+j*1024/(n-1)
   if inside(x,z,gbg):continue
   for a in water:
    if inside(x,z,a['p']) and not any(inside(x,z,h) for h in a['holes']):
     h=min(hs[j*n+i],a['level']-.4)
     if h!=hs[j*n+i]:patch[key]['terrain'].append([j*n+i,round(h,3)])
     break
out=Path('public/maps/details/seoul');out.mkdir(parents=True,exist_ok=True)
for key,p in patch.items():(out/(key+'.json')).write_text(json.dumps(p,ensure_ascii=False,separators=(',',':'))+'\n')
manifest=dict(version=1,cell=[37,126],radiusM=500,chunks=list(patch),targets=[dict(id=t['id'],name=t['name'],lat=t['lat'],lon=t['lon'],source=t['url'],sha256=t['sha256']) for t in targets])
Path('src/world/cities/seoul-detail-index.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=1)+'\n')
report=dict(targets=[dict(name=t['name'],id=t['id'],matched=sum(r['matched'] for r in rows if t['id'] in r['targets']),architecture=sum(bool(r['kind']) and r['matched'] for r in rows if t['id'] in r['targets']),unmatched=sum(not r['matched'] for r in rows if t['id'] in r['targets'])) for t in targets],rows=rows,incompleteRelations=incomplete,precincts=[f['tags'].get('name') for f in precincts],totals={k:sum(len(p[k]) for p in patch.values()) for k in ['buildings','areas','paths','walls','water','trees','terrain']})
(BASE/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=1));print(json.dumps(report['totals']),flush=True);print('special',[(r['name'],r['kind'],r['matched']) for r in rows if r['name'] in special],flush=True)
