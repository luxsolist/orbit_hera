"""Source-role audit shared by all city street builds."""
import json,sys,math,collections,hashlib
from pathlib import Path
def audit(data):
 counts=collections.Counter();errors=[];review=[];raised=courtyards=0
 for c in data['chunks']:
  for kind in ('buildings','structures'):
   for b in c['objects'].get(kind,[]):
    counts[b.get('facilityKind','building')]+=1
    ident=b.get('osmId','authored');clearance=b.get('groundClearance',0)
    if not math.isfinite(clearance) or clearance<0:errors.append(dict(id=ident,reason='invalid-clearance'))
    if clearance:
     raised+=1
     if not b.get('clearanceSource'):errors.append(dict(id=ident,reason='missing-clearance-source'))
     if b.get('h',math.inf)<=clearance:review.append(dict(id=ident,reason='height-at-or-below-clearance'))
    courtyards+=bool(b.get('holes'))
    if kind=='buildings' and b.get('structureKind'):errors.append(dict(id=ident,reason='open-structure-in-solid-buildings'))
    if kind=='structures' and not b.get('structureKind'):errors.append(dict(id=ident,reason='missing-open-role'))
 return dict(chunks=len(data['chunks']),roles=dict(counts),raised=raised,courtyards=courtyards,errors=errors,review=review)
if __name__=='__main__':
 city,region=sys.argv[1:3];base=Path('build/streets')/(city+'-'+region)
 raw=Path(str(base)+'-resolved-input.json').read_bytes()
 result=audit(json.loads(raw));result['inputHash']=hashlib.sha256(raw).hexdigest()
 Path(str(base)+'-structure-audit.json').write_text(json.dumps(result,indent=2))
 print(json.dumps({**result,'errors':len(result['errors']),'review':len(result['review'])}))
 if result['errors']:raise SystemExit(1)
