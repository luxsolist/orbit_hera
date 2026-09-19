from pathlib import Path
import json,math,re,statistics,collections,xml.etree.ElementTree as E
BASE=Path('build/busan-reference'); all_targets=json.loads((BASE/'index.json').read_text()); targets=[t for t in all_targets if t['status']=='cached']
if any(t['status']=='error' for t in all_targets):raise ValueError('Incomplete source downloads')
M=111320*math.cos(math.radians(35.5)); nodes={};ways={};rels={}
for t in targets:
 for e in E.parse(t['file']).getroot():
  d={'node':nodes,'way':ways,'relation':rels}.get(e.tag)
  if d is not None:d[e.attrib['id']]=e
print('XML loaded',len(nodes),len(ways),len(rels),flush=True)
def tags(e):return {t.get('k'):t.get('v') for t in e.findall('tag')}
def point(n):return [round((float(n.get('lon'))-129)*M,3),round((36-float(n.get('lat')))*111320,3)]
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
for t in targets:t['x']=(t['lon']-129)*M;t['z']=(36-t['lat'])*111320
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

# Source boundaries, not arbitrary landmark circles, determine traditional buildings.
precincts=[f for f in features if f['tags'].get('name') in ['범어사','해동용궁사','동래향교','금강암','대성암','내원암','청련암','계명암'] and not f['tags'].get('building') and len(f['p'])>=6 and f.get('closed',True)]
raw={};grid=collections.defaultdict(list)
for x,z in centers:
 for cx in range(int((x-650)//1024),int((x+650)//1024)+1):
  for cz in range(int((z-650)//1024),int((z+650)//1024)+1):
   key=f'{cx}_{cz}';path=Path(f'public/maps/35/129/{cx//16}_{cz//16}/{key}.json')
   if key not in raw and path.exists():raw[key]=json.loads(path.read_text())
for key,c in raw.items():
 for b in c['objects']['buildings']:
  x,z=cent(b['p']);grid[int(x//50),int(z//50)].append((key,b))
def match(p):
 x,z=cent(p);box=bounds(p);hits=[]
 for gx in range(int(x//50)-1,int(x//50)+2):
  for gz in range(int(z//50)-1,int(z//50)+2):
   for key,b in grid[gx,gz]:
    q=b['p']
    if max(abs(a-v) for a,v in zip(box,bounds(q)))>2:continue
    if all(dist(p[i],p[i+1],q)<=2 for i in range(0,len(p),2)) and all(dist(q[i],q[i+1],p)<=2 for i in range(0,len(q),2)):hits.append((key,b))
 return hits[0] if len(hits)==1 else None
patch={key:dict(buildings=[],remove=[],areas=[],paths=[],walls=[],water=[],trees=[],terrain=[]) for key in raw}
def affected(p):
 a=bounds(p)
 return [key for key,c in raw.items() if a[0]<=(c['cx']+1)*1024 and a[2]>=c['cx']*1024 and a[1]<=(c['cz']+1)*1024 and a[3]>=c['cz']*1024]
museumSites=[f for f in features if f['tags'].get('name')=='부산박물관' and not f['tags'].get('building')]
rows=[];unmatched=[]
colors=['#d3e5e3','#e9bcb1','#eddaa7','#b5d5e3','#c1d4ad','#d9c4de']
for f in features:
 p=f['p'];t=f['tags'];name=t.get('name:ko',t.get('name',''));x,z=cent(p)
 near=[a['id'] for a in targets if math.hypot(x-a['x'],z-a['z'])<=500]
 if near and t.get('building') not in [None,'no','construction'] and len(p)>=6 and f.get('closed',True):
  traditional=t.get('building') in ['temple','shrine'] or t.get('roof:shape')=='hipped-and-gabled' or any(inside(x,z,a['p']) for a in precincts)
  if t.get('building') in ['school','university','commercial','apartments','office'] or '박물관' in name or '휴게소' in name:traditional=False
  kind='gate-single' if traditional and (name.endswith('문') or name=='조계문') else 'korean' if traditional else ''
  h=8 if traditional else None;source='type-estimate' if traditional else None
  ht=numeric(t.get('height'));lv=numeric(t.get('building:levels'))
  if ht and 0<ht<830:h=ht;source='osm-height'
  elif lv and 0<lv<200 and not traditional:h=round(lv*3.3,1);source='levels-estimate'
  if f['id']=='way/480601129':kind='busan-tower';h=120;source='osm-height'
  if f['id']=='way/382696296':kind='busan-jagalchi';h=32;source='type-estimate'
  if any(inside(x,z,a['p']) for a in museumSites) and (bounds(p)[2]-bounds(p)[0])*(bounds(p)[3]-bounds(p)[1])>500:kind='busan-museum';h=h or 12;source=source or 'type-estimate'
  if f['id']=='way/690176797':kind='museum';h=3;source='type-estimate'
  if f['id']=='way/690176796':kind='busan-pavilion';h=10;source='type-estimate'
  hit=match(p)
  if hit:
   key,b=hit
   entry=dict(id=f['id'],p=b['p'],holes=f['holes'],name=name,h=h,kind=kind,roof=t.get('roof:shape','hipped-and-gabled' if traditional else 'flat'),heightSource=source,heightTag=t.get('height'),levelsTag=t.get('building:levels'))
   # Low-rise colors only within the Gamcheon study radius; height/placement preserved.
   if 'busan-7' in near and (h or b.get('h',10))<18 and not traditional:
    entry['wallColor']=colors[int(f['id'].split('/')[1])%len(colors)]
   patch[key]['buildings'].append(entry)
   if f['id'] in ['way/1238722288','way/1238722289']:patch[key]['remove'].append(b['p'])
   rows.append(dict(id=f['id'],name=name,key=key,kind=kind,heightSource=source,targets=near))
  elif kind:unmatched.append(dict(id=f['id'],name=name,kind=kind))
 if len(p)>=6 and f.get('closed',True) and (t.get('natural') in ['wood','scrub','grassland','sand','beach','water','bare_rock'] or t.get('landuse') in ['forest','grass'] or t.get('leisure') in ['park','garden','pitch']):
  kind='water' if t.get('natural')=='water' else 'wood' if t.get('natural')=='wood' or t.get('landuse')=='forest' else 'sand' if t.get('natural') in ['sand','beach'] else 'rock' if t.get('natural')=='bare_rock' else 'grass'
  a=dict(id=f['id'],p=p,holes=f['holes'],kind=kind)
  for key in affected(p):patch[key]['water' if kind=='water' else 'areas'].append(a)
 if t.get('highway') in ['footway','pedestrian','path','steps'] and len(p)>=4 and t.get('bridge') in [None,'no']:
  a=dict(id=f['id'],p=p,width=min(12,numeric(t.get('width')) or 2.5),bridge=False,tunnel=t.get('tunnel') not in [None,'no'],surface=t.get('surface','unknown'))
  for key in affected(p):patch[key]['paths'].append(a)
 if t.get('barrier') in ['wall','city_wall'] and len(p)>=4:
  a=dict(id=f['id'],p=p+(p[:2] if f.get('closed') else []),h=numeric(t.get('height')) or (4 if t.get('historic')=='citywalls' else 2))
  for key in affected(p):patch[key]['walls'].append(a)
for id,n in nodes.items():
 if tags(n).get('natural')!='tree':continue
 x,z=point(n);key=f'{int(x//1024)}_{int(z//1024)}'
 if key in patch and any(math.hypot(x-a,z-b)<=500 for a,b in centers):patch[key]['trees'].append([x,z])
# Supplement forest canopies on a sparse deterministic grid, never on mapped buildings/paths.
for key,d in patch.items():
 c=raw[key];existing=d['trees'];forest=[a for a in d['areas'] if a['kind']=='wood']
 for x in range(c['cx']*1024+24,(c['cx']+1)*1024,48):
  for z in range(c['cz']*1024+24,(c['cz']+1)*1024,48):
   if len(d['trees'])>=96:break
   if not any(math.hypot(x-a,z-b)<=500 for a,b in centers):continue
   if not any(inside(x,z,a['p']) and not any(inside(x,z,h) for h in a['holes']) for a in forest):continue
   if any(inside(x,z,b['p']) for b in c['objects']['buildings']):continue
   if any(dist(x,z,p['p'],False)<p['width']/2+4 for p in d['paths']):continue
   if any(math.hypot(x-a,z-b)<16 for a,b in existing):continue
   d['trees'].append([x,z])
# Bridge footprints provide orientation/extent; vertical dimensions remain stated estimates.
for f in features:
 t=f['tags'];name=t.get('name:ko',t.get('name',''))
 if t.get('man_made')!='bridge' or name not in ['광안대교','영도대교']:continue
 p=f['p'];longest=0;angle=0
 for i in range(0,len(p),2):
  j=(i+2)%len(p);dx=p[j]-p[i];dz=p[j+1]-p[i+1]
  if dx*dx+dz*dz>longest:longest=dx*dx+dz*dz;angle=math.atan2(dz,dx)
 c=math.cos(angle);ss=math.sin(angle);us=[p[i]*c+p[i+1]*ss for i in range(0,len(p),2)];vs=[-p[i]*ss+p[i+1]*c for i in range(0,len(p),2)]
 u=(min(us)+max(us))/2;v=(min(vs)+max(vs))/2
 a=dict(id=f['id'],name=name,x=u*c-v*ss,z=u*ss+v*c,angle=angle,length=max(us)-min(us),width=max(vs)-min(vs),deck=50 if name=='광안대교' else 8,tower=105 if name=='광안대교' else 0,status='osm-plan-photo-height-estimate')
 key=f"{int(a['x']//1024)}_{int(a['z']//1024)}"
 if key in patch:patch[key].setdefault('bridges',[]).append(a)
out=Path('public/maps/details/busan');out.mkdir(parents=True,exist_ok=True)
for key,d in patch.items():(out/(key+'.json')).write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')))
summary=dict(patches=len(patch),buildings=len(rows),models=sum(bool(r['kind']) for r in rows),unmatched=unmatched)
index=dict(version=1,cell=[35,129],chunks=sorted(patch),targets=targets,unresolved=[t for t in all_targets if t['status']!='cached'],summary=summary)
Path('src/world/cities/busan-detail-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2))
(out/'audit.json').write_text(json.dumps(dict(summary=summary,buildings=rows),ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False),flush=True)
