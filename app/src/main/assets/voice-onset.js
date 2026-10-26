// Energy-based candidate detector: sound is not proof of speech. Confirmation required.
(function(root){
class Detector {
 constructor(){this.last=-Infinity;this.noise=0.003;this.candidate=null;this.active=false;this.quiet=0;this.end=-Infinity;}
 push(f){if(!f||!Number.isFinite(f.atMs)||f.atMs<this.last||!Number.isFinite(f.rms)||f.rms<0||f.rms>1||!Number.isFinite(f.durationMs)||f.durationMs<=0||f.durationMs>100)throw Error('Invalid PCM frame');
  if(f.atMs-this.end>200){this.candidate=null;this.active=false;this.quiet=0;}
  this.last=f.atMs;this.end=f.atMs+f.durationMs;
  const loud=f.rms>Math.max(0.015,this.noise*3);
  if(!loud&&!this.active)this.noise=this.noise*0.98+f.rms*0.02;
  if(this.active){this.quiet=loud?0:this.quiet+f.durationMs;if(this.quiet>=700){this.active=false;this.candidate=null;this.quiet=0;}return null;}
  if(!loud){this.candidate=null;return null;}
  if(!this.candidate)this.candidate={atMs:f.atMs,sample:f.sample,clockQuality:f.clockQuality,duration:0};
  this.candidate.duration+=f.durationMs;if(this.candidate.duration<80)return null;
  this.active=true;return {...this.candidate,requiresConfirmation:true,source:'energy-onset-candidate'};
 }
}
const api={Detector};if(typeof module!=='undefined')module.exports=api;else root.VoiceOnset=api;
})(typeof window!=='undefined'?window:this);
