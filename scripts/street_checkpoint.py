"""Integrity checked reuse of a completed street design; encoding stays fresh."""
import ast,hashlib,json,pickle
from pathlib import Path
ENCODING_ONLY={'encode_region','delivery_clip','main'}
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def design_signature(compiler):
 tree=ast.parse(Path(compiler).read_text())
 tree.body=[node for node in tree.body if not isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) or node.name not in ENCODING_ONLY]
 return hashlib.sha256(ast.dump(tree,include_attributes=False).encode()).hexdigest()
def metadata(input_path,compiler,checkpoint):
 return dict(version=1,inputHash=digest(input_path),designHash=design_signature(compiler),checkpointHash=digest(checkpoint))
def load_design(input_path,compiler,checkpoint):
 checkpoint=Path(checkpoint);meta=checkpoint.with_suffix('.meta.json')
 if not checkpoint.exists() or not meta.exists():return None
 stored=json.loads(meta.read_text())
 if stored!=metadata(input_path,compiler,checkpoint):return None
 return pickle.loads(checkpoint.read_bytes())
def save_design(input_path,compiler,checkpoint,result):
 checkpoint=Path(checkpoint);tmp=checkpoint.with_suffix('.tmp');tmp.write_bytes(pickle.dumps(result));tmp.replace(checkpoint)
 meta=checkpoint.with_suffix('.meta.json');tmp=meta.with_suffix('.tmp');tmp.write_text(json.dumps(metadata(input_path,compiler,checkpoint),sort_keys=True));tmp.replace(meta)
