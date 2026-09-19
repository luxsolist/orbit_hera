"""City source snapshots on GitHub Releases. Requires Python 3 and authenticated gh."""
import argparse,hashlib,io,json,subprocess,tarfile,tempfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
CITIES=json.loads((ROOT/'config/map-cities.json').read_text())
CITY='seoul'
GRID='37/126'
CONFIG=ROOT/'config/map-releases/seoul.json'
def configure(city):
 global CITY,GRID,CONFIG
 CITY=city;GRID='/'.join(map(str,CITIES[city]));CONFIG=ROOT/f'config/map-releases/{city}.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def run(*args):return subprocess.check_output(args,cwd=ROOT,text=True).strip()
def sources():
 m=json.loads((ROOT/f'public/maps/{GRID}/tiles.json').read_text());paths={f'public/maps/{GRID}/tiles.json'}
 for c in m['chunks']:
  x,z=c['cx'],c['cz'];k=f'{x}_{z}';base=f"public/maps/{GRID}/{x//m.get('block',16)}_{z//m.get('block',16)}/{k}.json"
  if not (ROOT/base).exists():raise RuntimeError('Restore sources first: '+base)
  paths.add(base)
  for name in [f'public/maps/details/{CITY}/{k}.json',f'public/maps/road-grade/{GRID}/{k}.json',f'public/maps/landmark-appearance/{CITY}/{k}.json']:
   if (ROOT/name).exists():paths.add(name)
 return sorted(paths)
def prepare():
 files={p:(ROOT/p).read_bytes() for p in sources()};index=(ROOT/f'src/world/{CITY}-bundles.json').read_bytes()
 # Ensure the release snapshot is exactly the source represented by the playable bundles.
 bundle=json.loads(index)
 import gzip
 for entry in bundle['bundles'].values():
  data=(ROOT/f'public/maps/bundles/{CITY}'/entry['file']).read_bytes()
  if sha(data)!=entry['sha256']:raise RuntimeError('Bundle hash mismatch')
  for key,c in json.loads(gzip.decompress(data))['chunks'].items():
   x,z=map(int,key.split('_'));p=f'public/maps/{GRID}/{x//16}_{z//16}/{key}.json'
   if c['raw']!=json.loads(files[p]):raise RuntimeError('Rebuild bundles: '+key)
   for field,path in [('detail',f'public/maps/details/{CITY}/{key}.json'),('roadGrade',f'public/maps/road-grade/{GRID}/{key}.json'),('appearance',f'public/maps/landmark-appearance/{CITY}/{key}.json')]:
    if c[field]!=(json.loads(files[path]) if path in files else None):raise RuntimeError('Rebuild bundles: '+path)
 manifest={'version':1,'files':{p:sha(b) for p,b in files.items()},'bundleIndexSha256':sha(index)}
 encoded=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode();version=sha(encoded)[:16]
 tag=f'maps-{CITY}-'+version;out=ROOT/'build/map-releases'/tag;out.mkdir(parents=True,exist_ok=True)
 archive=out/f'{CITY}-source.tar.gz'
 with tarfile.open(archive,'w:gz') as tar:
  for name,b in {**files,'MANIFEST.json':encoded,'bundle-index.json':index}.items():
   info=tarfile.TarInfo(name);info.size=len(b);info.mtime=0;info.mode=0o644;tar.addfile(info,io.BytesIO(b))
 metadata={'version':1,'repository':run('gh','repo','view','--json','nameWithOwner','--jq','.nameWithOwner'),'tag':tag,'asset':archive.name,'sha256':sha(archive.read_bytes()),'bundleIndexSha256':sha(index),'sourceFiles':len(files),'bytes':archive.stat().st_size}
 (out/'release.json').write_text(json.dumps(metadata,indent=2)+'\n');print(out);return out,metadata

def checked(archive,meta):
 if sha(archive.read_bytes())!=meta['sha256']:raise RuntimeError('Archive SHA256 mismatch')
 with tarfile.open(archive,'r:gz') as tar:
  members=tar.getmembers();names=[m.name for m in members]
  if len(names)!=len(set(names)) or any(not m.isfile() for m in members):raise RuntimeError('Invalid archive members')
  data={m.name:tar.extractfile(m).read() for m in members};manifest=json.loads(data.pop('MANIFEST.json'));index=data.pop('bundle-index.json')
  if sha(index)!=meta['bundleIndexSha256'] or sha(index)!=manifest['bundleIndexSha256']:raise RuntimeError('Index mismatch')
  if set(data)!=set(manifest['files']):raise RuntimeError('Inventory mismatch')
  for name,b in data.items():
   p=Path(name)
   if p.is_absolute() or '..' in p.parts or not name.startswith('public/maps/') or not name.endswith('.json') or sha(b)!=manifest['files'][name]:raise RuntimeError('Invalid source: '+name)
  return data

def download(meta,directory):
 url=f"https://github.com/{meta['repository']}/releases/download/{meta['tag']}/{meta['asset']}"
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'OrbitHeraMapRestore/1.0'}),timeout=120) as response:(directory/meta['asset']).write_bytes(response.read())
 except Exception:
  run('gh','release','download',meta['tag'],'--repo',meta['repository'],'--pattern',meta['asset'],'--dir',str(directory),'--clobber')
 return directory/meta['asset']
def publish():
 out,meta=prepare();notes=out/'notes.md';notes.write_text(f'{CITY} map source snapshot. Includes terrain, landmark detail, appearance and road-grade overlays. Matched game bundle index SHA-256: '+meta['bundleIndexSha256']+'\n')
 exists=subprocess.run(['gh','release','view',meta['tag'],'--repo',meta['repository']],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
 if not exists:run('gh','release','create',meta['tag'],str(out/meta['asset']),str(out/'release.json'),'--repo',meta['repository'],'--target',run('git','rev-parse','HEAD'),'--title',CITY+' map source '+meta['tag'].removeprefix(f'maps-{CITY}-'),'--notes-file',str(notes),'--latest=false')
 else:
  # Existing releases are immutable snapshots; accept only the already-published bytes.
  with tempfile.TemporaryDirectory() as temp:
   run('gh','release','download',meta['tag'],'--repo',meta['repository'],'--pattern','release.json','--dir',temp)
   published=json.loads((Path(temp)/'release.json').read_text())
   if published['bundleIndexSha256']!=meta['bundleIndexSha256']:raise RuntimeError('Release conflict')
   meta=published
 with tempfile.TemporaryDirectory() as temp:checked(download(meta,Path(temp)),meta)
 CONFIG.parent.mkdir(parents=True,exist_ok=True);CONFIG.write_text(json.dumps(meta,indent=2)+'\n');print('Published and downloaded/verified:',meta['tag'])
def restore():
 meta=json.loads(CONFIG.read_text())
 with tempfile.TemporaryDirectory() as temp:data=checked(download(meta,Path(temp)),meta)
 written=kept=0
 for name,b in data.items():
  p=ROOT/name
  if not p.resolve().is_relative_to(ROOT.resolve()):raise RuntimeError('Unsafe restoration target')
  # Never replace local edits; this command restores missing files only.
  if p.exists():kept+=1;continue
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);written+=1
 print('Restored',written,'files; preserved',kept,'existing files')
def ensure():
 m=json.loads((ROOT/f'public/maps/{GRID}/tiles.json').read_text());block=m.get('block',16)
 if all((ROOT/f"public/maps/{GRID}/{c['cx']//block}_{c['cz']//block}/{c['cx']}_{c['cz']}.json").exists() for c in m['chunks']):return
 restore()
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('command',choices=['prepare','publish','restore','ensure']);parser.add_argument('--city',choices=list(CITIES),default='seoul');args=parser.parse_args();configure(args.city);{'prepare':prepare,'publish':publish,'restore':restore,'ensure':ensure}[args.command]()
