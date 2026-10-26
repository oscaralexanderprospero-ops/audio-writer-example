// Claude, 24 Oct 2026: the Control Room link in ui.js, with the phone's Native.oms bridge simulated.
const t=require('node:test'),a=require('node:assert/strict');
function harness(){
 const vm=require('node:vm'),fs=require('node:fs'),elements={},calls=[];
 function el(){const e={value:'',textContent:'',className:'',children:[],replaceChildren(){this.children=[];},append(x){this.children.push(x);}};e.classList={add:c=>{if(!e.className.split(' ').includes(c))e.className=(e.className+' '+c).trim();},remove:c=>{e.className=e.className.split(' ').filter(x=>x!==c).join(' ');}};return e;}
 let saved='';
 const context={JournalReplay:require('../app/src/main/assets/journal-replay.js'),Core:require('../app/src/main/assets/core.js'),
  Transcript:require('../app/src/main/assets/transcript.js'),OMSOutbox:require('../app/src/main/assets/oms-outbox.js'),
  OMSAdapter:require('../app/src/main/assets/oms-adapter.js'),
  document:{getElementById:id=>elements[id]||(elements[id]=el()),querySelectorAll:()=>[],createElement:el},
  Native:{load:()=>'',save:x=>{saved=x;return true;},replay(){},narrate(){},stop(){},mute(){},stopNotePlayback(){},
   omsLinked:()=>true,setReadingRate:r=>calls.push({rate:r}),speakAside:t=>calls.push({aside:t}),keepMicrophone:s=>calls.push({hold:s}),tone:k=>calls.push({tone:k}),stop(){calls.push({stop:true});},mute(){calls.push({mute:true});},clockMillis:()=>context.clock||0,record(){calls.push({record:true});},deleteNoteAudio:x=>(calls.push({del:x}),true),restoreNoteAudio:x=>(calls.push({restore:x}),true),purgeNoteAudio:x=>(calls.push({purge:x}),true),
   trimNoteAudio:(x,s)=>(calls.push({trim:x,s}),JSON.stringify({total:context.total||40,kept:(context.total||40)-s,tail:x+'.cut-1.pcm'})),untrimNoteAudio:(x,t)=>(calls.push({untrim:x,t}),true),takeOpen:()=>{const w=context.open||'';context.open='';return w;},oms:(id,method,path,body)=>calls.push({id,method,path,body:body?JSON.parse(body):null})},window:{},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(fs.readFileSync('app/src/main/assets/ui.js','utf8'),context);
 const reply=(status,body)=>context.window.nativeEvent('omsResult',JSON.stringify({id:calls.at(-1).id,status,body:JSON.stringify(body)}));
 return {ctx:context,el:id=>context.document.getElementById(id),calls,reply,saved:()=>JSON.parse(saved),native:context.window.nativeEvent};
}
const tick=()=>new Promise(r=>setTimeout(r,10)); // after the app's own setTimeout(…,0) steps
const snap={schema:1,kind:'oms-writing-snapshot',writingId:'WP-0001',revision:'r3',text:'First line. Second line.'};

t('lists picked drafts, loads one, sends notes once with an exact receipt',async()=>{
 const h=harness();a.match(h.el('omsState').textContent,/Linked/);
 h.el('omsList').onclick();a.equal(h.calls.at(-1).path,'/companion/v1/writings');
 h.reply(200,{writings:[{writingId:'WP-0001',title:'The Rowan Wand',revision:'r3'}]});await tick();
 a.equal(h.el('omsWritings').children.length,1);a.match(h.el('omsWritings').children[0].textContent,/Rowan/);
 h.el('omsWritings').children[0].onclick();a.equal(h.calls.at(-1).path,'/companion/v1/writings/WP-0001');
 h.reply(200,snap);await tick();
 a.equal(h.el('draft').value,snap.text);a.match(h.el('status').textContent,/Loaded "The Rowan Wand"/);
 h.el('note').value='Make the first line warmer';h.el('add').onclick();
 h.el('omsSend').onclick();await tick();
 const sent=h.calls.at(-1);a.equal(sent.method,'POST');a.equal(sent.path,'/companion/v1/edit-requests');
 a.equal(sent.body.writingId,'WP-0001');a.equal(sent.body.baseRevision,'r3');a.equal(sent.body.baseText,snap.text);
 a.equal(sent.body.request.notes.length,1);a.equal(sent.body.request.notes[0].text,'Make the first line warmer');
 h.reply(200,{schema:1,kind:'oms-edit-review-receipt',idempotencyKey:sent.body.idempotencyKey,writingId:'WP-0001',baseRevision:'r3',status:'received',reviewId:'AW-001'});await tick();
 a.match(h.el('status').textContent,/Sent/);a.equal(h.saved().omsOutbox[0].status,'received');
 const before=h.calls.length;h.el('omsSend').onclick();await tick();a.equal(h.calls.length,before);a.match(h.el('status').textContent,/Already sent/);
});

t('notes on an edited version still go with the loaded draft as base',async()=>{
 const h=harness();h.el('omsList').onclick();h.reply(200,{writings:[{writingId:'WP-0001',title:'Rowan',revision:'r3'}]});await tick();
 h.el('omsWritings').children[0].onclick();h.reply(200,snap);await tick();
 h.el('note').value='Spoken-style note on the original';h.el('add').onclick();
 h.el('draft').value='First line, warmer. Second line.';h.el('save').onclick();
 h.el('omsSend').onclick();await tick();const sent=h.calls.at(-1).body;
 a.equal(sent.baseRevision,'r3');a.equal(sent.request.version.text,'First line, warmer. Second line.');a.equal(sent.request.notes.length,1);
});

t('not linked, a failed send and a wrong receipt are shown and nothing is marked sent',async()=>{
 let h=harness();h.el('omsList').onclick();h.reply(401,{error:'no'});await tick();a.match(h.el('status').textContent,/Link Audio Writer/);
 h=harness();h.el('omsSend').onclick();await tick();a.match(h.el('status').textContent,/Load a draft/);
 h.el('omsList').onclick();h.reply(200,{writings:[{writingId:'WP-0001',title:'Rowan',revision:'r3'}]});await tick();
 h.el('omsWritings').children[0].onclick();h.reply(200,snap);await tick();h.el('note').value='n';h.el('add').onclick();
 h.el('omsSend').onclick();await tick();h.reply(0,'');await tick();a.match(h.el('status').textContent,/Not sent/);a.equal(h.saved().omsOutbox[0].status,'queued');
 const key=h.saved().omsOutbox[0].payload.idempotencyKey;h.el('omsSend').onclick();await tick();a.equal(h.calls.at(-1).body.idempotencyKey,key);
 h.reply(200,{schema:1,kind:'oms-edit-review-receipt',idempotencyKey:'other',writingId:'WP-0001',baseRevision:'r3',status:'received',reviewId:'AW-1'});await tick();
 a.match(h.el('status').textContent,/Not sent/);a.equal(h.saved().omsOutbox[0].status,'queued');
 h.native('omsLink','error:the link code is used up');a.match(h.el('status').textContent,/Link failed: the link code is used up/);
});

t('words being recorded show beside the text: finished words, then the grey guess (Claude)',async()=>{
 const h=harness();const box=h.el('liveWords');a.match(box.children[0].textContent,/Start audio note/);
 h.native('recording','note-1.wav');
 h.native('transcript',JSON.stringify({audio:'note-1.wav',final:false,originMs:null,timingQuality:'x',result:{partial:'make this'}}));
 a.equal(box.children.length,1);a.equal(box.children[0].textContent,'make this');a.equal(box.children[0].className,'partial');
 h.native('transcript',JSON.stringify({audio:'note-1.wav',final:true,originMs:0,timingQuality:'x',result:{text:'make this warmer',result:[]}}));
 h.native('transcript',JSON.stringify({audio:'note-1.wav',final:false,originMs:0,timingQuality:'x',result:{partial:'and shorter'}}));
 a.equal(box.children[0].textContent,'make this warmer ');a.equal(box.children[1].textContent,'and shorter');a.equal(box.children[1].className,'partial');
});

t('Open in Audio Writer from the Control Room loads that writing once (Claude)',async()=>{
 const h=harness();h.ctx.open='WP-0001';h.native('omsOpen','WP-0001');
 a.equal(h.calls.at(-1).path,'/companion/v1/writings');h.reply(200,{writings:[{writingId:'WP-0001',title:'The Rowan Wand',revision:'r3'}]});await tick();
 a.equal(h.calls.at(-1).path,'/companion/v1/writings/WP-0001');h.reply(200,snap);await tick();
 a.equal(h.el('draft').value,snap.text);a.match(h.el('status').textContent,/Loaded "The Rowan Wand"/);
 const versions=h.saved().versions.length;h.ctx.open='WP-0001';h.native('omsOpen','WP-0001');
 h.reply(200,{writings:[{writingId:'WP-0001',title:'The Rowan Wand',revision:'r3'}]});await tick();
 a.match(h.el('status').textContent,/already loaded/);a.equal(h.saved().versions.length,versions);
 h.ctx.open='WP-0009';h.native('omsOpen','WP-0009');h.reply(200,{writings:[]});await tick();a.match(h.el('status').textContent,/not in your list/);
});

const note=(h,audio,words)=>{h.native('recording',audio);
 h.native('transcript',JSON.stringify({audio,final:true,originMs:0,timingQuality:'x',result:{text:words.map(w=>w[0]).join(' '),result:words.map(([word,start,end])=>({word,start,end,conf:1}))}}));};
const delBtn=h=>h.el('notes').children.find(x=>x.className==='quiet del'||x.className==='quiet del armed');
t('a note and its audio: two taps to delete, restore, or delete for good (Claude)',()=>{
 const h=harness();h.el('draft').value='First line. Second line.';h.el('save').onclick();note(h,'note-111.wav',[['cut',1,2],['line',2,3]]);h.native('recorded','note-111.wav');
 delBtn(h).onclick();a.equal(h.saved().notes.length,1,'one tap only arms it');a.match(delBtn(h).textContent,/Tap again/);
 delBtn(h).onclick();let s=h.saved();a.equal(s.notes.length,0);a.equal(s.deletedNotes.length,1);a.ok(h.calls.some(c=>c.del==='note-111.wav'));
 a.equal(h.el('deletedBox').hidden,false);a.match(h.el('deletedNotes').children[0].children[0].textContent,/cut line/);
 h.el('deletedNotes').children[0].children[1].onclick();s=h.saved();a.equal(s.notes.length,1);a.equal(s.deletedNotes.length,0);a.ok(h.calls.some(c=>c.restore==='note-111.wav'));
 delBtn(h).onclick();delBtn(h).onclick();const gone=h.el('deletedNotes').children[0].children[2];gone.onclick();gone.onclick();
 s=h.saved();a.equal(s.notes.length,0);a.equal(s.deletedNotes.length,0);a.ok(h.calls.some(c=>c.purge==='note-111.wav'));a.equal(h.el('deletedBox').hidden,true);
});
t('a note still recording cannot be deleted by its own button (Claude)',()=>{
 const h=harness();h.native('recording','note-222.wav');delBtn(h).onclick();delBtn(h).onclick();a.equal(h.saved().notes.length,1);a.match(h.el('status').textContent,/Finish the audio note first/);
});
t('cut the last 30 seconds of a finished note, words and audio, then undo (Claude)',()=>{
 const h=harness();note(h,'note-333.wav',[['keep',2,3],['this',4,5],['drop',15,16],['that',30,31]]);h.native('recorded','note-333.wav');
 h.el('cut30').onclick();a.ok(h.calls.some(c=>c.trim==='note-333.wav'&&c.s===30));let n=h.saved().notes[0];
 a.equal(n.recognition.segments[0].text,'keep this');a.equal(n.cutoffSec,10);a.match(h.el('status').textContent,/last 30 seconds/);
 h.el('notes').children.find(x=>x.textContent==='↷ Undo last cut').onclick();n=h.saved().notes[0];
 a.equal(n.recognition.segments[0].text,'keep this drop that');a.equal(n.cuts.length,0);a.equal(n.cutoffSec,undefined);a.ok(h.calls.some(c=>c.untrim==='note-333.wav'));
});
t('while recording, Cut last minute finishes the note, cuts it and records again; late words are cut too (Claude)',async()=>{
 const h=harness();h.ctx.total=100;note(h,'note-444.wav',[['early',5,6],['late',70,71]]);
 h.el('cut60').onclick();a.match(h.el('status').textContent,/Cutting, then recording again/);
 h.native('transcript',JSON.stringify({audio:'note-444.wav',final:true,originMs:0,timingQuality:'x',result:{text:'later still',result:[{word:'later',start:75,end:76},{word:'still',start:76,end:77}]}}));
 h.native('recorded','note-444.wav');await tick();
 const n=h.saved().notes.find(x=>x.audio==='note-444.wav');a.ok(h.calls.some(c=>c.trim==='note-444.wav'&&c.s===60));
 a.deepEqual(n.recognition.segments.map(s=>s.text),['early']);a.equal(n.cutoffSec,40);a.ok(h.calls.some(c=>c.record));
 h.native('transcript',JSON.stringify({audio:'note-444.wav',final:true,originMs:0,timingQuality:'x',result:{text:'tail',result:[{word:'tail',start:78,end:79}]}}));
 a.deepEqual(h.saved().notes.find(x=>x.audio==='note-444.wav').recognition.segments.map(s=>s.text),['early']);
});
t('Scrap note & retry while recording: the note goes to Deleted notes and recording starts again on the same passage (Claude)',async()=>{
 const h=harness();h.el('draft').value='Alpha one. Beta two.';h.el('save').onclick();note(h,'note-555.wav',[['oops',1,2]]);const anchor=h.saved().notes[0].anchor;
 h.el('retry').onclick();h.native('recorded','note-555.wav');await tick();
 const s=h.saved();a.equal(s.notes.length,0);a.equal(s.deletedNotes.length,1);a.ok(h.calls.some(c=>c.record));a.equal(s.pendingRecordAnchor.passage,anchor.passage);
});

t('each piece of a note shows beside the sentence being read when it was said, and can be edited or deleted (Claude)',()=>{
 const h=harness();h.el('draft').value='First sentence. Second sentence. Third sentence.';h.el('save').onclick();
 h.native('recording','note-701.wav');const anchor=h.saved().notes[0].anchor;
 h.native('narrationPosition',JSON.stringify({atMs:1000,mode:'narrating',index:2,offset:0,anchor:{...anchor,index:2,passage:' Third sentence.'}}));
 h.native('transcript',JSON.stringify({audio:'note-701.wav',final:true,originMs:null,timingQuality:'x',result:{text:'start here',result:[]}}));
 h.native('transcript',JSON.stringify({audio:'note-701.wav',final:true,originMs:0,timingQuality:'x',result:{text:'and fix this',result:[{word:'and',start:2,end:2.2},{word:'fix',start:2.2,end:2.5},{word:'this',start:2.5,end:2.8}]}}));
 h.native('recorded','note-701.wav');h.el('note').value='typed one';h.el('add').onclick();
 const box=()=>h.el('annotated').children;const at=t=>box().findIndex(x=>x.className.startsWith('atext')&&x.textContent.trim()===t);
 const notesAfter=t=>box()[at(t)+1];
 a.equal(notesAfter('First sentence.').className,'anotes');a.equal(notesAfter('First sentence.').children[0].textContent,'start here');
 a.equal(notesAfter('Third sentence.').children[0].textContent,'and fix this');
 notesAfter('Third sentence.').children[0].onclick();const ed=notesAfter('Third sentence.').children[0];a.match(ed.className,/editing/);
 ed.children[0].value='and fix this line';ed.children[1].onclick();
 a.equal(h.saved().notes[0].recognition.segments[1].text,'and fix this line');a.equal(h.saved().notes[0].recognition.segments[1].original,'and fix this');
 notesAfter('First sentence.').children[0].onclick();const ed2=notesAfter('First sentence.').children[0];ed2.children[2].onclick();ed2.children[2].onclick();
 const n=h.saved().notes[0];a.deepEqual(n.recognition.segments.map(s=>s.text),['and fix this line']);a.equal(n.removedSegments.length,1);
 a.ok(box().some(x=>x.className==='anotes'&&x.children.some(c=>/typed one/.test(c.textContent))));
});

t('while reading, the text scrolls along with the sentence and word being heard; Pause brings the edit box back (Claude)',()=>{
 const h=harness();h.el('draft').value='One two three. Four five six. Seven eight nine.';h.el('save').onclick();
 a.equal(h.el('reader').hidden,true);a.equal(h.el('draft').hidden,false);
 h.el('play').onclick();a.equal(h.el('reader').hidden,false);a.equal(h.el('draft').hidden,true);a.match(h.el('draftLabel').textContent,/Pause to edit/);
 const s=h.saved();const v=s.versions.find(x=>x.id===s.current);
 h.native('narrationRange',JSON.stringify({atMs:5,mode:'narrating',index:1,offset:5,anchor:{versionId:v.id,versionHash:v.hash,index:1,passage:' Four five six.'}}));
 const kids=h.el('reader').children;a.equal(kids.length,3);a.match(kids[1].className,/now/);a.doesNotMatch(kids[0].className,/now/);
 a.ok(kids[1].children.some(c=>c.textContent.trim()==='five'),'the word being heard is marked');
 h.native('narrationPosition',JSON.stringify({atMs:9,mode:'paused',index:1,offset:6,anchor:{versionId:v.id,versionHash:v.hash,index:1,passage:' Four five six.'}}));
 a.equal(h.el('reader').hidden,true);a.equal(h.el('draft').hidden,false);
});

t('Scroll and talk: no reading aloud, and words attach to the sentence visible in the box when they were said (Claude)',()=>{
 const h=harness();h.el('draft').value='Alpha one. Beta two. Gamma three. Delta four.';h.el('save').onclick();
 h.ctx.clock=1000;h.el('scrollMode').onclick();a.equal(h.el('reader').hidden,false);a.equal(h.el('draft').hidden,true);a.equal(h.el('scrollHint').hidden,false);
 const box=h.el('reader');const kids=box.children;a.equal(kids.length,4);
 // lay the sentences out 100px apart in a 300px-tall box, then scroll so the reading line (100px down) sits on Gamma
 kids.forEach((k,i)=>{k.offsetTop=i*100;k.offsetHeight=100;});box.offsetTop=0;box.clientHeight=300;
 h.native('recording','note-901.wav');
 h.ctx.clock=5000;box.scrollTop=150;box.onscroll();return new Promise(r=>setTimeout(r,200)).then(()=>{
  a.match(kids[2].className,/now/);const hist=h.saved().playbackHistory;a.equal(hist.at(-1).anchor.index,2);a.equal(hist.at(-1).mode,'reading');
  // said at 6 s on the same clock: originMs 0 + word at 6 s, after the scroll at 5 s, so it belongs beside Gamma
  h.native('transcript',JSON.stringify({audio:'note-901.wav',final:true,originMs:0,timingQuality:'x',result:{text:'gamma needs work',result:[{word:'gamma',start:6,end:6.3},{word:'needs',start:6.3,end:6.6},{word:'work',start:6.6,end:7}]}}));
  h.native('recorded','note-901.wav');
  const ann=h.el('annotated').children;const gi=ann.findIndex(x=>x.className.startsWith('atext')&&x.textContent.trim()==='Gamma three.');
  a.equal(ann[gi+1].className,'anotes');a.equal(ann[gi+1].children[0].textContent,'gamma needs work');
  a.match(h.el('draftLabel').textContent,/Scroll and talk/,'still scrolling, nothing read aloud');
  h.el('scrollMode').onclick();a.equal(h.el('reader').hidden,true);a.equal(h.el('draft').hidden,false);
 });
});

const say=(h,audio,text,start=1)=>h.native('transcript',JSON.stringify({audio,final:true,originMs:null,timingQuality:'x',result:{text,result:text.split(' ').map((w,i)=>({word:w,start:start+i*.3,end:start+i*.3+.25}))}}));
t('spoken commands: acted on while recording, never saved as notes, and only when said on their own (Claude)',async()=>{
 const h=harness();h.el('draft').value='One a. Two b. Three c.\nFour d. Five e.';h.el('save').onclick();
 h.native('recording','note-1201.wav');say(h,'note-1201.wav','the first line needs work');
 h.el('play').onclick();say(h,'note-1201.wav','writer pause');await tick();
 let n=h.saved().notes[0];a.deepEqual(n.recognition.segments.map(s=>s.text),['the first line needs work']);a.equal(n.commands[0].cmd,'pause');
 a.ok(h.calls.some(c=>c.stop),'reading paused');a.match(h.el('lastCommand').textContent,/writer pause/);
 say(h,'note-1201.wav','pause the music in the second part');await tick();n=h.saved().notes[0];a.equal(n.recognition.segments.length,2,'a sentence that only mentions pause is a note');
 say(h,'note-1201.wav','scratch that');await tick();n=h.saved().notes[0];a.deepEqual(n.recognition.segments.map(s=>s.text),['the first line needs work']);a.equal(n.removedSegments.at(-1).by,'spoken command');
 say(h,'note-1201.wav','next paragraph');await tick();a.match(h.el('position').textContent,/Sentence 4/);
 say(h,'note-1201.wav','go back please');await tick();a.match(h.el('position').textContent,/Sentence 3/);
 say(h,'note-1201.wav','new note');await tick();a.ok(h.calls.some(c=>c.mute),'note finished');h.native('recorded','note-1201.wav');await tick();a.ok(h.calls.some(c=>c.record),'next note started');
});
t('spoken commands are not acted on again when saved events are replayed after reopening (Claude)',async()=>{
 const h=harness();h.el('draft').value='One a. Two b.';h.el('save').onclick();const before=h.calls.length;
 h.ctx.window.journalBatch([[1,'recording','note-1301.wav'],[2,'transcript',JSON.stringify({audio:'note-1301.wav',final:true,originMs:null,timingQuality:'x',result:{text:'next',result:[]}})]]);await tick();
 const n=h.saved().notes.find(x=>x.audio==='note-1301.wav');a.equal(n.recognition?.segments?.length||0,0,'still not saved as a note');a.equal(n.commands.length,1);
 a.match(h.el('position').textContent,/Sentence 1/,'not acted on');a.equal(h.calls.slice(before).filter(c=>c.stop||c.mute||c.record).length,0);
});

t('Start over button: two taps, back to the first sentence, this writing\'s notes go to Deleted notes (Claude)',()=>{
 const h=harness();h.el('draft').value='One a. Two b. Three c.';h.el('save').onclick();
 h.native('recording','note-1401.wav');say(h,'note-1401.wav','first thought');h.native('recorded','note-1401.wav');
 h.el('note').value='typed thought';h.el('add').onclick();
 h.el('annotated').children.find(x=>x.className.startsWith('atext')&&x.textContent.trim()==='Three c.').onclick();
 a.match(h.el('position').textContent,/Sentence 3/);
 h.el('startOver').onclick();a.equal(h.saved().notes.length,2,'one tap only arms it');
 h.el('startOver').onclick();const s=h.saved();a.equal(s.notes.length,0);a.equal(s.deletedNotes.filter(d=>d.reason==='start over').length,2);
 a.match(h.el('position').textContent,/Sentence 1/);a.ok(h.calls.some(c=>c.del==='note-1401.wav'));
 h.el('deletedNotes').children[0].children[1].onclick();a.equal(h.saved().notes.length,1,'restorable');
});
t('saying "start over" while recording and reading: finishes the note, clears, records afresh and reads from the top (Claude)',async()=>{
 const h=harness();h.el('draft').value='One a. Two b. Three c.';h.el('save').onclick();
 h.native('recording','note-1501.wav');say(h,'note-1501.wav','a thought about two');h.el('play').onclick();
 say(h,'note-1501.wav','writer start over');await tick();a.ok(h.calls.some(c=>c.mute),'note finished');
 h.native('recorded','note-1501.wav');await tick();
 const s=h.saved();a.equal(s.notes.length,0);a.equal(s.deletedNotes.at(-1).reason,'start over');a.ok(h.calls.some(c=>c.record),'fresh note started');
 a.equal(s.pendingRecordAnchor.index,0);a.match(h.el('position').textContent,/Sentence 1/);a.equal(h.el('reader').hidden,false,'reading from the top');
});

t('one Start button starts reading and recording; Stop ends both; Back and Next move a sentence (Claude)',()=>{
 const h=harness();h.el('draft').value='One a. Two b. Three c.';h.el('save').onclick();
 h.el('startAll').onclick();a.ok(h.calls.some(c=>c.record),'recording asked for');a.equal(h.el('reader').hidden,false,'reading');a.match(h.el('startAll').textContent,/Reading and recording/);
 h.el('nextSentence').onclick();a.match(h.el('position').textContent,/Sentence 2/);h.el('prevSentence').onclick();a.match(h.el('position').textContent,/Sentence 1/);
 h.native('recording','note-1601.wav');h.el('stopAll').onclick();a.ok(h.calls.some(c=>c.mute),'note finished');a.equal(h.el('reader').hidden,true,'reading stopped');
});
t('Delete all progress: two taps remove this writing\'s notes and recordings for good, including Deleted notes (Claude)',()=>{
 const h=harness();h.el('draft').value='One a. Two b.';h.el('save').onclick();
 h.native('recording','note-1701.wav');say(h,'note-1701.wav','keep this');h.native('recorded','note-1701.wav');
 h.native('recording','note-1702.wav');say(h,'note-1702.wav','and this');h.native('recorded','note-1702.wav');
 const del=h.el('notes').children.filter(x=>/del/.test(x.className))[1];del.onclick();del.onclick();a.equal(h.saved().deletedNotes.length,1);
 h.el('wipe').onclick();a.equal(h.saved().notes.length,1,'one tap only arms it');h.el('wipe').onclick();
 const s=h.saved();a.equal(s.notes.length,0);a.equal(s.deletedNotes.length,0);a.ok(h.calls.some(c=>c.purge==='note-1701.wav'));a.ok(h.calls.some(c=>c.purge==='note-1702.wav'));
 a.equal(h.el('deletedBox').hidden,true);a.match(h.el('status').textContent,/The text is kept/);
});

t('speed, text size, flag, read back and undo, by button and by voice, with a beep for each command (Claude)',async()=>{
 const h=harness();h.el('draft').value='One a. Two b. Three c.';h.el('save').onclick();
 h.el('faster').onclick();a.ok(h.calls.some(c=>c.rate&&Math.abs(c.rate-1.436)<.01));a.match(h.el('speedLabel').textContent,/110%/);
 h.el('textBigger').onclick();a.equal(h.saved().textScale,1.15);
 h.el('flag').onclick();let s=h.saved();a.equal(s.notes.length,1);a.ok(s.notes[0].flag);h.el('undoLast').onclick();a.equal(h.saved().notes.length,0,'flag undone');
 h.native('recording','note-1801.wav');say(h,'note-1801.wav','make this warmer');
 say(h,'note-1801.wav','slower');await tick();a.ok(h.calls.some(c=>c.tone==='ok'));a.match(h.el('speedLabel').textContent,/100%/);
 say(h,'note-1801.wav','scratch that');await tick();a.equal(h.saved().notes[0].recognition.segments.length,0);
 say(h,'note-1801.wav','undo that');await tick();a.deepEqual(h.saved().notes[0].recognition.segments.map(x=>x.text),['make this warmer']);
 say(h,'note-1801.wav','read that back');await tick();a.ok(h.calls.some(c=>c.aside==='make this warmer'));
 say(h,'note-1801.wav','echo of make this warmer',5);a.equal(h.saved().notes[0].recognition.segments.length,1,'what the mic hears during read-back is set aside');
 h.native('asideDone','');say(h,'note-1801.wav','after it',9);a.equal(h.saved().notes[0].recognition.segments.length,2);
 say(h,'note-1801.wav','bigger text');await tick();a.ok(h.saved().textScale>1.3);
});
t('at the one-hour limit the note finishes and the next starts by itself, holding the microphone (Claude)',async()=>{
 const h=harness();h.el('draft').value='One a. Two b.';h.el('save').onclick();h.native('recording','note-1901.wav');
 h.native('captureLimit','note-1901.wav');a.ok(h.calls.some(c=>c.hold===15));h.native('recorded','note-1901.wav');await tick();
 a.ok(h.calls.some(c=>c.record),'next note started');a.equal(h.saved().notes.length,1,'the finished note is kept');
});
