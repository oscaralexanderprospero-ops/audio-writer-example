const test=require('node:test'),assert=require('node:assert/strict'),V=require('../app/src/main/assets/voice-onset.js'),H=require('../app/src/main/assets/onset-history.js');

const frame=(atMs,rms=.1)=>({atMs,rms,durationMs:20,sample:atMs*16,clockQuality:'hardware'});

test('onset is first sustained loud frame, not detection completion time',()=>{const d=new V.Detector();for(let t=0;t<100;t+=20)assert.equal(d.push(frame(t,.002)),null);for(let t=100;t<160;t+=20)assert.equal(d.push(frame(t)),null);const onset=d.push(frame(160));assert.equal(onset.atMs,100);assert.equal(onset.sample,1600);const match=H.atOnset([{atMs:0,passage:'earlier'},{atMs:140,passage:'later'}],onset.atMs);assert.equal(match.anchor.passage,'earlier');assert.equal(onset.requiresConfirmation,true);});

test('clicks do not trigger; sustained sound needs silence to start next candidate',()=>{const d=new V.Detector();assert.equal(d.push(frame(0)),null);assert.equal(d.push(frame(20,.001)),null);let found=[];for(let t=40;t<1000;t+=20){const x=d.push(frame(t));if(x)found.push(x);}assert.equal(found.length,1);for(let t=1000;t<1800;t+=20)d.push(frame(t,.001));for(let t=1800;t<1880;t+=20){const x=d.push(frame(t));if(x)found.push(x);}assert.equal(found.length,2);assert.equal(found[1].atMs,1800);});

test('invalid timing, gaps and silence cannot invent a transcript',()=>{const d=new V.Detector();d.push(frame(100));assert.throws(()=>d.push(frame(99)));assert.throws(()=>d.push(frame(120,NaN)));d.push(frame(500));d.push(frame(520));assert.equal(d.push(frame(540)),null);const x=d.push(frame(560));assert.equal(x.atMs,500);assert.equal(x.text,undefined);assert.equal(x.source,'energy-onset-candidate');});

test('batched UI frames preserve earlier onset and manual correction without fake transcript',()=>{const vm=require('node:vm'),fs=require('node:fs'),C=require('../app/src/main/assets/core.js');const elements={};function el(){return {value:'',textContent:'',children:[],replaceChildren(){this.children=[];},append(x){this.children.push(x);}};}

 let saved='';const ctx={Transcript:require('../app/src/main/assets/transcript.js'),Core:C,VoiceOnset:V,OnsetHistory:H,document:{getElementById:id=>elements[id]||(elements[id]=el()),querySelectorAll:()=>[],createElement:el},Native:{load:()=>'',save:x=>(saved=x,true),speak(){},stop(){},record(){},mute(){},stopNotePlayback(){}},window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/src/main/assets/ui.js','utf8'),ctx);

 elements.draft.value='First. Second.';elements.save.onclick();elements.play.onclick();ctx.window.nativeEvent('playbackClock','1:0:0');elements.record.onclick();ctx.window.nativeEvent('recording','note-1.wav');ctx.window.nativeEvent('done','1');ctx.window.nativeEvent('playbackClock','2:0:140');ctx.window.nativeEvent('pcmLevels',JSON.stringify([100,120,140,160,180].map(t=>({...frame(t),audio:'note-1.wav'}))));

 const note=JSON.parse(saved).notes[0];assert.equal(note.text,'');assert.equal(note.onsetCandidates[0].match.anchor.anchor.passage,'First.');assert.match(note.status,/incomplete/);const label=elements.notes.children.find(e=>e.textContent.startsWith('Type or correct'));label.children[0].value='Use a warmer opening';elements.notes.children.find(e=>e.textContent==='Save corrected note text').onclick();assert.equal(JSON.parse(saved).notes[0].textSource,'user');assert.equal(JSON.parse(saved).notes[0].text,'Use a warmer opening');ctx.window.nativeEvent('transcriptState',JSON.stringify({audio:'note-1.wav',complete:true,reason:''}));ctx.window.nativeEvent('recorded','note-1.wav');assert.match(JSON.parse(saved).notes[0].status,/ready for correction/);

});

