import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export function assetEditor(){
 const token=randomUUID();let queue=Promise.resolve();
 return {name:'asset-editor',apply:'serve',configureServer(server){
  const file=resolve(server.config.root,'public/missions/index.json');
  const revision=s=>createHash('sha256').update(s).digest('hex');
  server.middlewares.use('/api/editor/landmarks',async(req,res)=>{
   try{
    const catalog=JSON.parse(await readFile(resolve(server.config.root,'public/maps/index.json'),'utf8'));
    const source=JSON.parse(await readFile(resolve(server.config.root,'scripts/data/landmark-catalog.json'),'utf8'));
    const cities=JSON.parse(await readFile(resolve(server.config.root,'scripts/data/city-catalog.json'),'utf8')).cities;
    const result={};
    for(const city of catalog){const ko=cities.find(c=>c.id+'-stream'===city.id)?.cityKo??city.name.split('·')[0].trim().replace(' 도심','');
     for(const landmark of source.cities[ko]??[])if(Number.isFinite(landmark.lat)&&Number.isFinite(landmark.lon))result[city.id+':'+landmark.name]={name:landmark.name,mapId:city.id,lat:landmark.lat,lon:landmark.lon};
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
   }catch{res.statusCode=500;res.end('{}');}
  });
  server.middlewares.use('/api/editor/missions',async(req,res)=>{
   const send=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
   try{
    if(req.method==='GET'){const raw=await readFile(file,'utf8');return send(200,{missions:JSON.parse(raw),revision:revision(raw),token});}
    if(req.method!=='PUT')return send(405,{error:'지원하지 않는 요청입니다.'});
    const origin=req.headers.origin;if(!origin||new URL(origin).host!==req.headers.host||req.headers['x-editor-token']!==token)return send(403,{error:'편집기에서 다시 접속하세요.'});
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2e6)return send(413,{error:'요청이 너무 큽니다.'});}
    const body=JSON.parse(raw);
    const task=queue.then(async()=>{
     const before=await readFile(file,'utf8');if(body.revision!==revision(before))return send(409,{error:'다른 편집에서 변경되었습니다. 목록을 다시 불러온 후 저장하세요.'});
     const cities=JSON.parse(await readFile(resolve(server.config.root,'public/maps/index.json'),'utf8'));
     const {validateMission}=await server.ssrLoadModule('/src/editor/missionSchema.ts');
     validateMission(body.mission,cities.map(c=>c.id));
     const list=JSON.parse(before),index=list.findIndex(m=>m.id===body.mission.id);
     if(body.create&&index>=0)return send(409,{error:'같은 ID가 이미 있습니다.'});
     if(!body.create&&index<0)return send(404,{error:'수정할 미션이 없습니다.'});
     if(index>=0)list[index]=body.mission;else list.push(body.mission);
     const next=JSON.stringify(list,null,1)+'\n',tmp=file+'.'+randomUUID()+'.tmp';
     const backups=resolve(server.config.root,'build/editor-backups');await mkdir(backups,{recursive:true});await writeFile(resolve(backups,'missions.json'),before);await writeFile(tmp,next);await rename(tmp,file);
     send(200,{missions:list,revision:revision(next),token});
    });queue=task.catch(()=>{});await task;
   }catch(error){send(400,{error:error.message||'저장 실패'});}
  });
 }};
}
