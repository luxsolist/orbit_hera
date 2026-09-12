/** Bounded, allocation-free frame sampling. Time excludes pauses/background tabs. */
export class CombatMetrics {
  seconds=0;
  simulationSeconds=0;
  frames=0;
  kills=0;
  lowFrequencySeconds=0;
  firstDeathSeconds: number | null=null;
  deaths=0;
  private bins=new Uint32Array(2001);
  sample(frameSeconds:number,simulationSeconds:number,kills:number,frequencyRatio:number):void {
    if(!Number.isFinite(frameSeconds)||frameSeconds<=0)return;
    this.seconds+=frameSeconds;
    this.simulationSeconds+=Math.max(0,simulationSeconds);
    this.frames++;
    this.kills=kills;
    if(frequencyRatio<.25)this.lowFrequencySeconds+=frameSeconds;
    this.bins[Math.min(2000,Math.ceil(frameSeconds*1000))]++;
  }
  died():void {this.deaths++;this.firstDeathSeconds??=this.seconds;}
  get fps():number{return this.seconds?this.frames/this.seconds:0;}
  get killsPerMinute():number{return this.seconds?this.kills*60/this.seconds:0;}
  get lowFrequencyPercent():number{return this.seconds?100*this.lowFrequencySeconds/this.seconds:0;}
  get p95FrameMs():number {
    const target=Math.ceil(this.frames*.95);if(!target)return 0;
    let n=0;for(let i=0;i<this.bins.length;i++){n+=this.bins[i];if(n>=target)return i;}return 2000;
  }
}
