"""Fetch a reproducible Geofabrik extract; avoid per-landmark Overpass requests.
Then run extract-seoul-landmark-appearance.py (requires pyosmium) and the builder.
"""
from pathlib import Path
import urllib.request,hashlib
url='https://download.geofabrik.de/asia/south-korea-260912.osm.pbf'
out=Path('build/seoul-reference/south-korea-260912.osm.pbf');out.parent.mkdir(parents=True,exist_ok=True)
checksum=urllib.request.urlopen(url+'.md5',timeout=30).read().decode().split()[0]
if not out.exists() or hashlib.md5(out.read_bytes()).hexdigest()!=checksum:
 tmp=out.with_suffix('.download')
 with urllib.request.urlopen(url,timeout=60) as response,tmp.open('wb') as target:
  while data:=response.read(1024*1024):target.write(data)
 if hashlib.md5(tmp.read_bytes()).hexdigest()!=checksum:raise ValueError('Source checksum mismatch')
 tmp.replace(out)
print('Verified',out)
