// Procedural ambience and cue sounds. Dialogue is presented as Korean subtitles.
export class CinematicAudio {
  private ctx:AudioContext;
  private master:GainNode;
  private drone:OscillatorNode;
  private disposed=false;
  private lastBeat=-1;
  private lastTime=0;
  constructor(){
    this.ctx=new AudioContext();
    this.master=this.ctx.createGain();this.master.gain.value=.22;this.master.connect(this.ctx.destination);
    this.drone=this.ctx.createOscillator();this.drone.type="sine";this.drone.frequency.value=44;
    const gain=this.ctx.createGain();gain.gain.value=.18;this.drone.connect(gain).connect(this.master);this.drone.start();
    if(this.ctx.state==="suspended")void this.ctx.resume();
  }
  enterScene(name:string){
    if(this.disposed)return;
    const roots:Record<string,number>={place:55,loss:49,observations:41.2,safety:36.7,link:55,encounter:41.2,remains:49,title:55};
    this.drone.frequency.setTargetAtTime(roots[name]??55,this.ctx.currentTime,.5);
  }
  private tone(frequency:number,duration:number,level:number){
    const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.frequency.setValueAtTime(frequency,t);o.frequency.exponentialRampToValueAtTime(frequency*.65,t+duration);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(level,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g).connect(this.master);o.start(t);o.stop(t+duration+.02);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  update(time:number){
    if(this.disposed)return;
    const beat=Math.floor(time*.8);
    if(time>=18&&time<62&&beat!==this.lastBeat){this.tone(62,.45,.18);this.lastBeat=beat;}
    for(const [cue,hz] of [[38,880],[43,1320],[48,240],[53,240],[58,85]]){
      if(this.lastTime<cue&&time>=cue)this.tone(hz,.35,.2);
    }
    this.lastTime=time;
  }
  stop(fade:number){
    if(this.disposed)return;
    const t=this.ctx.currentTime;this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(Math.max(.0001,this.master.gain.value),t);
    this.master.gain.exponentialRampToValueAtTime(.0001,t+Math.max(.05,fade));
  }
  dispose(){if(this.disposed)return;this.disposed=true;void this.ctx.close();}
}
