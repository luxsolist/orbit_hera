import "./drone-model-menu.css";

interface PreviewEntry {id:string;name:string;preview?:string;previewLabel?:string;}
const header=document.createElement("header");header.className="drone-model-menu";
const title=document.createElement("span");title.className="drone-model-menu__title";title.textContent="드론 모델링";
const nav=document.createElement("nav");nav.setAttribute("aria-label","드론 모델 선택");
header.append(title,nav);document.body.prepend(header);document.body.classList.add("has-drone-model-menu");
function render(entries:PreviewEntry[]){
 nav.replaceChildren();
 for(const entry of entries){
  if(!entry.preview)continue;
  const url=new URL(entry.preview,location.origin);if(url.origin!==location.origin)continue;
  const link=document.createElement("a");link.href=url.pathname+url.search;link.textContent=entry.previewLabel??entry.name;link.dataset.droneModel=entry.id;
  if(url.pathname===location.pathname)link.setAttribute("aria-current","page");
  nav.append(link);
 }
}
// Keep navigation usable even if the optional registry request fails.
render([{id:"android-01",name:"워커",preview:"/tools/mech-preview.html"},{id:"drone-v1",name:"플라이어",preview:"/tools/flyer-preview.html"}]);
fetch("/models/index.json").then(async response=>{
 if(!response.ok)throw new Error("모델 목록을 불러오지 못했습니다.");
 const catalog=await response.json();
 if(!Array.isArray(catalog.assets))throw new Error("모델 목록 형식이 올바르지 않습니다.");
 const entries=catalog.assets.filter((a:PreviewEntry)=>typeof a.id==="string"&&typeof a.name==="string"&&typeof a.preview==="string");
 if(entries.length)render(entries);
}).catch(()=>{header.title="모델 목록을 불러오지 못해 기본 메뉴를 표시합니다.";});
