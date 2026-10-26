const t=require('node:test'),a=require('node:assert/strict'),J=require('../app/src/main/assets/journal-replay.js');
const event={seq:1,type:'final',value:'text'};
t('journal replay commits state and cursor atomically, skips duplicates',()=>{let disk;let s=J.apply({notes:[]},event,(s,e)=>s.notes.push(e.value),s=>(disk=JSON.stringify(s),true));s=J.apply(s,event,()=>{throw Error('duplicate');},()=>true);a.deepEqual(s.notes,['text']);a.equal(JSON.parse(disk).lastAppliedSeq,1);});
t('failed persistence retains original state for retry; gaps rejected',()=>{const s={notes:[]};a.throws(()=>J.apply(s,event,n=>n.notes.push('text'),()=>false));a.deepEqual(s,{notes:[]});a.throws(()=>J.apply(s,{...event,seq:2},()=>{},()=>true),/gap/);});

t('invalid persisted cursors cannot silently acknowledge events',()=>{for(const lastAppliedSeq of [-1,1.5,'1',null,NaN])a.throws(()=>J.apply({lastAppliedSeq},event,()=>{},()=>true),/cursor/);});

function harness(raw=''){
 const vm=require('node:vm'),fs=require('node:fs'),C=require('../app/src/main/assets/core.js'),elements={};
 function el(){return {value:'',textContent:'',children:[],replaceChildren(){this.children=[];},append(x){this.children.push(x);}};}
 let saved=raw,saves=0,queue=null,fail=false;
 const context={JournalReplay:J,Core:C,Transcript:require('../app/src/main/assets/transcript.js'),document:{getElementById:id=>elements[id]||(elements[id]=el()),querySelectorAll:()=>[],createElement:el},Native:{load:()=>raw,save:x=>{saves++;if(fail)return false;saved=x;return true;},replay(){},narrate(...args){queue=args;},stop(){},mute(){},stopNotePlayback(){}},window:{}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('app/src/main/assets/ui.js','utf8'),context);
 return {elements,event:context.window.journalEvent,batch:context.window.journalBatch,native:context.window.nativeEvent,save:()=>saved,count:()=>saves,queue:()=>queue,fail:()=>fail=true};
}
t('UI final-note replay survives restart and never duplicates notes or overwrites correction',()=>{
 let h=harness();h.elements.draft.value='First. Second.';h.elements.save.onclick();
 h.event(1,'recording','note-1.wav');h.event(2,'transcriptState',JSON.stringify({audio:'note-1.wav',complete:true,reason:''}));h.event(3,'recorded','note-1.wav');
 let disk=JSON.parse(h.save());a.equal(disk.notes.length,1);a.match(disk.notes[0].status,/ready for correction/);disk.notes[0].text='My correction';disk.notes[0].textSource='user';
 h=harness(JSON.stringify(disk));h.event(1,'recording','note-1.wav');h.event(3,'recorded','note-1.wav');a.equal(h.count(),0);
 h.event(4,'captureClosed','note-1.wav');disk=JSON.parse(h.save());a.equal(disk.notes.length,1);a.equal(disk.notes[0].text,'My correction');a.equal(disk.lastAppliedSeq,4);
});
t('native narration queue and recovery retain pause position without auto playback',()=>{
 let h=harness();h.elements.draft.value='First. Second.';h.elements.save.onclick();h.elements.play.onclick();const q=JSON.parse(h.queue()[0]);a.equal(q.length,2);
 h.event(1,'narrationPosition',JSON.stringify({atMs:200,mode:'paused',index:1,offset:2,anchor:q[1].anchor}));
 h=harness(h.save());a.equal(h.queue(),null);h.elements.play.onclick();a.equal(h.queue()[1],1);a.equal(h.queue()[2],2);
 h.event(2,'timingReset','new process');a.deepEqual(JSON.parse(h.save()).playbackHistory,[]);
});
t('UI replay save failure leaves disk cursor unchanged and stops later replay',()=>{
 const h=harness();h.event(1,'recording','note-1.wav');const before=h.save();h.fail();h.event(2,'recorded','note-1.wav');h.event(3,'captureClosed','note-1.wav');a.equal(h.save(),before);a.equal(JSON.parse(h.save()).lastAppliedSeq,1);
});

t('interruption replay preserves audio note and never starts narration',()=>{
 const h=harness();h.event(1,'recording','note-1.wav');h.event(2,'audioInterrupted','Headphones disconnected');
 a.equal(h.queue(),null);a.equal(JSON.parse(h.save()).notes.length,1);a.equal(JSON.parse(h.save()).lastAudioInterruption,'Headphones disconnected');
 h.event(3,'captureClosed','note-1.wav');a.equal(JSON.parse(h.save()).notes[0].captureStatus,'unverified');a.equal(h.elements.mic.textContent,'Microphone closed');
});
t('capture interruption is distinct from a completed partial transcript',()=>{
 const h=harness();h.event(1,'recording','note-1.wav');h.event(2,'captureClosed','note-1.wav');h.event(3,'transcriptState',JSON.stringify({audio:'note-1.wav',complete:true,reason:''}));
 const n=JSON.parse(h.save()).notes[0];a.equal(n.captureStatus,'unverified');a.equal(n.recognition.complete,true);a.match(h.elements.notes.children[0].textContent,/Audio completeness unverified/);
});

t('batched replay applies events with one save, skips duplicates and keeps the cursor (Claude)',()=>{
 const h=harness();h.event(1,'recording','note-1.wav');const before=h.count();
 h.batch([[1,'recording','note-1.wav'],[2,'transcriptState',JSON.stringify({audio:'note-1.wav',complete:true,reason:''})],[3,'recorded','note-1.wav']]);
 a.equal(h.count(),before+1);const disk=JSON.parse(h.save());a.equal(disk.lastAppliedSeq,3);a.equal(disk.notes.length,1);a.match(disk.notes[0].status,/ready for correction/);
 h.batch([[2,'recorded','note-1.wav']]);a.equal(h.count(),before+1);
});
t('batched replay with a gap or failed save changes nothing on disk (Claude)',()=>{
 let h=harness();h.event(1,'recording','note-1.wav');let before=h.save();h.batch([[2,'recorded','note-1.wav'],[4,'captureClosed','note-1.wav']]);a.equal(h.save(),before);
 h=harness();h.event(1,'recording','note-1.wav');before=h.save();h.fail();h.batch([[2,'recorded','note-1.wav']]);a.equal(h.save(),before);
});
t('live word ranges update position without saving; sentence positions save (Claude)',()=>{
 const h=harness();h.elements.draft.value='First. Second.';h.elements.save.onclick();h.elements.play.onclick();const q=JSON.parse(h.queue()[0]);const before=h.count();
 h.native('narrationRange',JSON.stringify({atMs:100,mode:'narrating',index:0,offset:3,anchor:q[0].anchor}));a.equal(h.count(),before);
 h.native('narrationPosition',JSON.stringify({atMs:200,mode:'paused',index:0,offset:3,anchor:q[0].anchor}));a.equal(h.count(),before+1);
 a.equal(JSON.parse(h.save()).playbackHistory.length,2);
});
