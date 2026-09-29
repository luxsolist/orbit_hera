import json,sys,collections
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import street_compile as s
city=sys.argv[1];region=sys.argv[2];base='build/streets/'+city+'-'+region
D=json.load(open(base+'-resolved-input.json')); audit=json.load(open(base+'-guide-audit.json')); failures=set(audit['failures']); chunks={(c['cx'],c['cz']):c for c in D['chunks']}; rows=[]
for r in D['roads']:
 if r['id'] not in failures:continue
 line=s.LineString(s.points(r['p'])); x0,z0,x1,z1=line.bounds; hits=[]
 for x in range(int(x0//1024),int(x1//1024)+1):
  for z in range(int(z0//1024),int(z1//1024)+1):
   c=chunks.get((x,z))
   if not c:continue
   for kind in ['buildings','structures','walls','water']:
    for o in c['objects'].get(kind,[]):
     if not s.nearby(o['p'],line.bounds):continue
     g=s.LineString(s.points(o['p'])).buffer(o.get('w',.4)/2) if kind=='walls' or kind=='water' and o.get('w') else s.ring(o)
     length=g.intersection(line).length
     if length>.01:hits.append(dict(kind=kind,id=o.get('osmId'),length=round(length,2)))
 rows.append(dict(id=r['id'],highway=r['highway'],name=r['name'],hits=hits))
counts=collections.Counter('+'.join(sorted({h['kind'] for h in r['hits']})) or 'clearance' for r in rows)
report=dict(counts=dict(counts),highways=dict(collections.Counter(r['highway'] for r in rows)),rows=rows)
json.dump(report,open(base+'-conflicts.json','w'));print(json.dumps({k:v for k,v in report.items() if k!='rows'}))
