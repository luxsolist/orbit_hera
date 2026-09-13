import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {Readable} from 'node:stream';
// @ts-expect-error development plugin
import {assetEditor} from '../scripts/vite-asset-editor.mjs';
import {validateMission} from '../src/editor/missionSchema';
import {normalizeMissionPool} from '../src/game/missions';
import missions from '../public/missions/index.json';
const mission=()=>({id:'test-mission',name:'테스트',cityId:'seoul-stream',stage:1,goal:{type:'purge-all'},deploy:{model:'roster',units:[{role:'marker',count:3,hp:1000}],spawnRadius:200},fail:{respawns:3,timeLimit:300,maxBuildingLoss:0,maxLandmarkLoss:0},zoneRadius:1000});
it('accepts all currently runnable missions without discarding advanced deployment settings',()=>{for(const m of normalizeMissionPool(missions))expect(()=>validateMission(m,[]),m.id).not.toThrow();});
it('rejects invalid spawn amounts, incompatible goals, and unavailable cities',()=>{
 for(const mutate of [(m:any)=>m.deploy.units[0].count=-1,(m:any)=>m.cityId='missing',(m:any)=>m.goal={type:'purge-role',role:'boss'},(m:any)=>m.goal={type:'purge',count:20},(m:any)=>m.deploy.units[0].hp=NaN]){const m=mission();mutate(m);expect(()=>validateMission(m,['seoul-stream'])).toThrow();}
});
it('writes atomically with backup, checks revision and token, then game normalization loads saved mission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'core-editor-'));try{
 await mkdir(join(root,'public/missions'),{recursive:true});await mkdir(join(root,'public/maps'),{recursive:true});
 const file=join(root,'public/missions/index.json');await writeFile(file,'[]');await writeFile(join(root,'public/maps/index.json'),JSON.stringify([{id:'seoul-stream'}]));let handler:any;
 assetEditor().configureServer({config:{root},ssrLoadModule:async()=>({validateMission}),middlewares:{use:(route:any,h:any)=>{if(route.endsWith("missions"))handler=h;}}});
 const call=async(method:string,body?:any,token?:string)=>{let result:any;const req=Readable.from(body?[JSON.stringify(body)]:[]) as any;req.method=method;req.headers={origin:'http://localhost:5173',host:'localhost:5173','x-editor-token':token};const res={statusCode:200,setHeader(){},end(data:string){result={status:this.statusCode,data:JSON.parse(data)};}};await handler(req,res);return result;};
 const initial=await call('GET');expect((await call('PUT',{create:true,revision:initial.data.revision,mission:mission()},'wrong')).status).toBe(403);
 const saved=await call('PUT',{create:true,revision:initial.data.revision,mission:mission()},initial.data.token);expect(saved.status).toBe(200);expect(normalizeMissionPool(JSON.parse(await readFile(file,'utf8')))[0].cityId).toBe('seoul-stream');expect(await readFile(join(root,'build/editor-backups/missions.json'),'utf8')).toBe('[]');
 expect((await call('PUT',{create:false,revision:initial.data.revision,mission:mission()},initial.data.token)).status).toBe(409);
 const modified=mission();modified.name='수정';expect((await call('PUT',{create:false,revision:saved.data.revision,mission:modified},initial.data.token)).status).toBe(200);expect(JSON.parse(await readFile(file,'utf8'))[0].name).toBe('수정');
 }finally{await rm(root,{recursive:true,force:true});}
});
