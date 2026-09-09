import { introCueAt } from "./sequence";
import "./cinematic.css";
export class CinematicOverlay {
  readonly element=document.createElement("div");
  private source:HTMLElement;
  private subtitle:HTMLElement;
  private clock:HTMLElement;
  private hud:HTMLElement;
  private title:HTMLElement;
  constructor(){
    this.element.className="cinematic";
    this.element.innerHTML='<div class="cinematic__top"><span class="cinematic__source"></span><span class="cinematic__clock"></span></div><div class="cinematic__hud"><i></i><span>로봇 연결 완료</span></div><div class="cinematic__title">CORE<small>우리가 살던 곳을 지키기 위해.</small></div><div class="cinematic__subtitle" aria-live="off"></div>';
    this.source=this.element.querySelector(".cinematic__source")!;
    this.subtitle=this.element.querySelector(".cinematic__subtitle")!;
    this.clock=this.element.querySelector(".cinematic__clock")!;
    this.hud=this.element.querySelector(".cinematic__hud")!;
    this.title=this.element.querySelector(".cinematic__title")!;
    document.body.append(this.element);
  }
  update(t:number){
    const cue=introCueAt(t);
    this.source.textContent=cue.source;
    this.clock.textContent=t<71 ? '기록 / '+Math.floor(t/60).toString().padStart(2,"0")+':'+Math.floor(t%60).toString().padStart(2,"0") : '';
    this.subtitle.textContent=cue.line;
    this.hud.style.opacity=t>=46&&t<62?'1':'0';
    this.title.style.opacity=t>=71?'1':'0';
  }
  dispose(){this.element.remove();}
}
