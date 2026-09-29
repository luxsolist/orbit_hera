import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {streetArtifacts,writeStreetPart} from '../scripts/street-artifacts.mjs';
it('streams individually verified chunk artifacts and rejects changed files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'street-artifacts-'));
 try{const part=writeStreetPart(dir,'0_0',{version:1,meshes:[]}),manifest=join(dir,'index.json');
 writeFileSync(manifest,JSON.stringify({format:'chunk-files',chunks:{'0_0':part}}));
 const reader=streetArtifacts(manifest);expect(reader.keys).toEqual(['0_0']);expect(reader.read('0_0').version).toBe(1);
 writeFileSync(part.file,JSON.stringify({version:2}));expect(()=>reader.read('0_0')).toThrow('changed');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
