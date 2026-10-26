'use strict';
const $=id=>document.getElementById(id), C=Core;
let state=C.fresh(),playing=false,index=0,offset=0,baseOffset=0,serial=0,utterance='',recordAnchor=null,recording=false,recordPending=false;
let playbackHistory=[],onsetDetector=null;
const native=typeof Native!=='undefined';
function status(t){$('status').textContent=t;}
try{let raw=native?Native.load():localStorage.getItem('oms-audio-working-copy');if(raw){state=C.restore(raw);if(!native||!Native.replay)C.recoverInterrupted(state);}}catch(e){status('Save could not be recovered. Original storage has not been overwritten. Reload or recover externally.');document.querySelectorAll('button').forEach(b=>b.disabled=true);throw e;}
playbackHistory=state.playbackHistory||[];if(state.narrationCursor?.versionId===state.current){index=state.narrationCursor.index;offset=state.narrationCursor.offset;}
let applyingJournal=false;
function persist(){if(applyingJournal)return true;let raw=JSON.stringify(state);try{if(native){if(!Native.save(raw))throw Error('Save failed');}else localStorage.setItem('oms-audio-working-copy',raw);return true;}catch(e){status('NOT SAVED: '+e.message);return false;}}
function stop(){if(native&&Native.clockMillis)rememberPlayback(Native.clockMillis(),'paused');playing=false;utterance='';if(native)Native.stop();}
function render(){let v=C.current(state);$('draft').value=state.editorText===undefined?v.text:state.editorText;$('position').textContent='Sentence '+(index+1)+' · local version '+v.id;$('notes').replaceChildren();for(let n of state.notes){let p=document.createElement('p');p.textContent=(n.captureStatus==='unverified'?'Audio completeness unverified | ':'')+n.status+': '+(n.text||n.audio||'')+' — '+n.anchor.passage;$('notes').append(p);if(n.audio){let button=document.createElement('button');button.textContent='Play saved audio note';button.onclick=()=>{if(recording||recordPending)return status('Finish recording before playing a note.');if(!native)return status('Note audio requires Android.');stop();Native.playNote(n.audio);};$('notes').append(button);addTranscriptControls(n);}addNoteFixControls(n);} $('reviews').replaceChildren();let relevant=state.proposals.filter(p=>p.versionId===state.current);if(relevant.length){let summary=document.createElement('p');summary.textContent=new Set(relevant.map(p=>p.reviewer)).size<2?'Waiting for the other reviewer.':JSON.stringify(relevant[0].patches)===JSON.stringify(relevant[relevant.length-1].patches)?'Reviewers supplied matching patches.':'Reviewer proposals differ. Compare each OLD/NEW below; no automatic selection.';$('reviews').append(summary);}for(let p of relevant){let pre=document.createElement('pre');pre.textContent=p.reviewer+' (unverified imported response)\n'+p.patches.map(x=>'OLD: '+x.before+'\nNEW: '+x.text).join('\n\n');$('reviews').append(pre);}}
function speak(){let a=C.sentences(C.current(state));if(index>=a.length){stop();status('Reading complete');return;}if(!native){status('Audio requires the Android build. Browser is editor-only.');return;}Native.stopNotePlayback();playing=true;baseOffset=offset;utterance=String(++serial);if(Native.narrate)Native.narrate(JSON.stringify(a.map((x,i)=>({text:x.text,anchor:C.anchor(state,i,0)}))),index,offset);else Native.speak(a[index].text.slice(offset),utterance);$('position').textContent='Sentence '+(index+1)+' of '+a.length;}
window.nativeEvent=(type,value)=>{if(type==='audioInterrupted'){state.lastAudioInterruption=value;playing=false;utterance='';recordPending=false;status(value);$('mic').textContent=recording?'Microphone closing after interruption':'Microphone closed';}else if(type==='timingReset'){state.playbackHistory=[];playbackHistory=[];playing=recording=recordPending=false;persist();}else if(type==='narrationPaused'){playing=false;utterance='';status(value);}else if(type==='narrationPosition'||type==='narrationRange'){const p=JSON.parse(value);if(!Number.isFinite(p.atMs)||!p.anchor)throw Error('Invalid narration position');playbackHistory=state.playbackHistory||[];playbackHistory.push({atMs:p.atMs,mode:p.mode,anchor:p.anchor});if(playbackHistory.length>20000)playbackHistory.shift();state.playbackHistory=playbackHistory;if(p.anchor.versionId===state.current){index=p.index;offset=p.offset;state.narrationCursor={versionId:state.current,index,offset};playing=p.mode==='narrating';}if(type==='narrationPosition')persist();}else if(type==='narrationEnded'){playing=false;status('Reading complete');}else if(type==='sessionState'){recording=value.split(':')[0]==='recording';playing=value.split(':')[1]==='playing';recordPending=false;$('mic').textContent=recording?'MICROPHONE RECORDING':'Microphone closed';}else if(type==='recognizerStatus'){try{const p=JSON.parse(value),n=state.notes.find(n=>n.audio===p.audio);if(n){n.recognitionStatus=p.message;status(p.message);}}catch(e){status('Invalid recognizer status');}}else if(type==='transcriptState'){try{const p=JSON.parse(value),n=state.notes.find(n=>n.audio===p.audio);if(n){Transcript.terminal(n,p);persist();render();}}catch(e){status(e.message);}}else if(type==='recognizer'){status(value);}else if(type==='transcript'){try{const p=JSON.parse(value),n=state.notes.find(n=>n.audio===p.audio);if(n){Transcript.receive(n,p,playbackHistory);if(p.final){persist();render();}else{status("Recognizing: "+n.recognition.partial);}}}catch(e){if(applyingJournal)throw e;status('Transcript rejected: '+e.message);}}else if(type==='pcmLevels'){try{const frames=JSON.parse(value);if(!Array.isArray(frames)||frames.length>5)throw Error('Invalid level batch');for(const frame of frames)captureLevel(JSON.stringify(frame));}catch(e){status(e.message);}}else if(type==='pcmLevel'){captureLevel(value);}else if(type==='playbackClock'){const [id,relative,clock]=value.split(':');if(id===utterance){offset=C.resumeOffset(baseOffset,Number(relative),C.sentences(C.current(state))[index]?.text.length||0);rememberPlayback(Number(clock),'narrating');}}else if(type==='captureClosed'){const n=state.notes.find(n=>n.audio===value);if(n&&n.captureStatus!=='finalized'){n.captureStatus='unverified';n.status='interrupted - recording completeness unverified';persist();}recording=recordPending=false;$('mic').textContent='Microphone closed';}else if(type==='notePlayback'){status(value);}else if(type==='done'&&playing&&value===utterance){index++;offset=0;speak();}else if(type==='range'){let [id,n]=value.split(':');if(id===utterance)offset=C.resumeOffset(baseOffset,Number(n),C.sentences(C.current(state))[index]?.text.length||0);}else if(type==='recording'){recording=true;recordPending=false;onsetDetector=typeof VoiceOnset!=='undefined'?new VoiceOnset.Detector():null;if(!state.notes.some(n=>n.audio===value))C.note(state,recordAnchor||state.pendingRecordAnchor||C.anchor(state,index,offset),'',value);state.notes.at(-1).status='recording — incomplete until finalized';persist();$('mic').textContent='MICROPHONE RECORDING';render();}else if(type==='recorded'){recording=false;let n=state.notes.find(n=>n.audio===value);if(n){n.captureStatus='finalized';const r=n.recognition;n.status=r?.complete===true?'recorded - transcript ready for correction':r?.complete===false?'recorded - transcript incomplete: '+r.reason:'recorded - transcribing';}persist();$('mic').textContent='Microphone closed';render();}else if(type==='recordError'){recordPending=false;$('mic').textContent=recording?'Microphone stopping after error':'Microphone closed';status(value);for(let n of state.notes)if(n.status.startsWith('recording'))n.status='recording failed or interrupted';persist();render();}else if(type==='error'){status(value);stop();}else if(type==='suspended'){stop();$('mic').textContent=recording?'Microphone closing':'Microphone closed';status(value);}};
$('draft').oninput=()=>{state.editorText=$('draft').value;persist();};
$('save').onclick=()=>{if(recording||recordPending)return status('Finish the audio note before changing its version.');stop();const omsBase=state.omsBases?.[state.current];const savedVersion=C.commit(state,$('draft').value);if(omsBase)state.omsBases[savedVersion.id]=JSON.parse(JSON.stringify(omsBase));delete state.editorText;index=offset=0;if(persist())status('Working copy saved locally; OMS unchanged.');render();};
$('undo').onclick=()=>{if(recording||recordPending)return status('Finish the audio note first.');let i=state.versions.findIndex(v=>v.id===state.current);if(i>0){stop();state.current=state.versions[i-1].id;delete state.editorText;index=offset=0;persist();render();}};
$('play').onclick=()=>{if($('draft').value!==C.current(state).text)return status('Save your working copy before narration.');speak();};$('pause').onclick=()=>{stop();status('Narration paused. Microphone state unchanged. Resume uses last engine range; otherwise sentence start.');};$('replay').onclick=()=>{stop();offset=0;speak();};
$('record').onclick=()=>{if(!native)return status('Recording requires Android.');if($('draft').value!==C.current(state).text)return status('Save the working copy first.');if(recording||recordPending)return;recordPending=true;recordAnchor=C.anchor(state,index,offset);recordAnchor.onsetSource='record-request';state.pendingRecordAnchor=recordAnchor;if(!persist()){recordPending=false;return;}Native.record();};$('stopNote').onclick=()=>{if(native)Native.stopNotePlayback();status('Saved note playback stopped');};$('mute').onclick=()=>{if(native)Native.mute();$('mic').textContent='Microphone closing';};
$('add').onclick=()=>{if(!$('note').value.trim())return;C.note(state,C.anchor(state,index,offset),$('note').value);if(persist()){$('note').value='';render();}};
$('export').onclick=()=>{$('exchange').value=JSON.stringify({...C.packet(state),authority:'OMS',localOnly:true},null,2);};$('import').onclick=()=>{try{if($('exchange').value.length>2000000)throw Error('Packet too large');const response=JSON.parse($('exchange').value);let p=response.requestId?ReviewRound.receive(state,activeRound(),response):C.validate(state,response);state.proposals=state.proposals.filter(x=>x.versionId!==p.versionId||x.reviewer!==p.reviewer);state.proposals.push(p);persist();render();roundStatus();status('Proposal saved for comparison only. OMS acceptance is not connected.');}catch(e){status('Rejected: '+e.message);}};render();

// OMS is authoritative. This UI only prepares a stable offline request.
if(state.omsOutbox){try{state.omsOutbox=OMSOutbox.restore(state.omsOutbox);}catch(e){document.querySelectorAll('button').forEach(b=>b.disabled=true);throw Error('Outbox recovery failed; storage preserved');}}
function outboxStatus(){ $('outboxStatus').textContent=(state.omsOutbox||[]).map(x=>x.payload.idempotencyKey+': '+x.status).join(' | ')||'No OMS requests queued. Live connection unconfigured.'; }
$('loadOms').onclick=()=>{try{
 if(recording||recordPending)throw Error('Finish recording before loading a writing');
 const base=OMSOutbox.snapshot(JSON.parse($('exchange').value));
 stop();const v=C.commit(state,base.text);state.omsBases=state.omsBases||{};state.omsBases[v.id]=base;delete state.editorText;index=offset=0;persist();render();status('Imported unverified OMS snapshot as a new local copy. Previous versions retained.');
}catch(e){status('Rejected: '+e.message);}};
$('queueOms').onclick=()=>{try{
 if(recording||recordPending)throw Error('Finish recording before exporting review');
 if($('draft').value!==C.current(state).text)throw Error('Save the working copy first');
 const base=state.omsBases?.[state.current];if(!base)throw Error('Load an OMS snapshot first; local text has no canonical base');
 const request=C.packet(state);state.omsOutbox=state.omsOutbox||[];
 const existing=state.omsOutbox.find(x=>JSON.stringify(x.payload.request)===JSON.stringify(request)&&x.payload.writingId===base.writingId&&x.payload.baseRevision===base.revision);
 const item=existing||OMSOutbox.enqueue(state.omsOutbox,base,request,'edit-'+state.current+'-'+Date.now());
 if(!persist())return;$('exchange').value=JSON.stringify(item.payload,null,2);outboxStatus();status('Offline request ready. Copy to OMS when its matching adapter is available. Nothing sent.');
}catch(e){status('Rejected: '+e.message);}};
$('receiptOms').onclick=()=>{try{const r=JSON.parse($('exchange').value);const item=(state.omsOutbox||[]).find(x=>x.payload.idempotencyKey===r.idempotencyKey);if(!item)throw Error('Unknown request');OMSOutbox.acknowledge(item,r);persist();outboxStatus();status('Unverified receipt recorded; canonical writing unchanged.');}catch(e){status('Rejected: '+e.message);}};
outboxStatus();

function rememberPlayback(atMs,mode){if(!Number.isFinite(atMs))return;const event={atMs,mode,anchor:C.anchor(state,index,offset)};playbackHistory.push(event);playbackHistory.sort((a,b)=>a.atMs-b.atMs);if(playbackHistory.length>20000)playbackHistory.shift();}
function captureLevel(raw){if(!onsetDetector)return;try{const f=JSON.parse(raw),n=state.notes.find(n=>n.audio===f.audio);if(!n)return;const onset=onsetDetector.push(f);if(!onset)return;const match=OnsetHistory.atOnset(playbackHistory,onset.atMs);n.onsetCandidates=n.onsetCandidates||[];if(n.onsetCandidates.length>=1000)return;n.onsetCandidates.push({...onset,match});persist();render();}catch(e){status('Timing candidate unavailable; audio retained.');}}
function addTranscriptControls(n){
 if(n.recognition){const raw=document.createElement('p');raw.textContent='Offline transcript (unconfirmed): '+Transcript.text(n)+(n.recognition.complete===false?' | Unconfirmed (recognizer stopped): ':' | In progress: ')+n.recognition.partial;$('notes').append(raw);const use=document.createElement('button');use.textContent='Copy transcript into correction field';use.onclick=()=>{n.correctionDraft=Transcript.text(n);persist();render();};$('notes').append(use);}

 const label=document.createElement('label');label.textContent='Type or correct this audio note';const input=document.createElement('textarea');input.value=n.correctionDraft===undefined?n.text:n.correctionDraft;input.oninput=()=>{n.correctionDraft=input.value;persist();};label.append(input);$('notes').append(label);
 const save=document.createElement('button');save.textContent='Save corrected note text';save.onclick=()=>{if(input.value.length>100000)return status('Note too long');try{C.correctNote(n,input.value);persist();status('Manual correction saved. Audio unchanged.');}catch(e){status(e.message);}};$('notes').append(save);
 for(const candidate of n.onsetCandidates||[]){const p=document.createElement('p');p.textContent='Sound onset candidate ('+candidate.clockQuality+'): '+(candidate.match.anchor?.anchor?.passage||'No retained passage')+(candidate.confirmed?' - confirmed':' - needs confirmation');$('notes').append(p);if(candidate.match.anchor?.anchor){const confirm=document.createElement('button');confirm.textContent='Confirm this passage for the note';confirm.onclick=()=>{n.originalAnchor=n.originalAnchor||JSON.parse(JSON.stringify(n.anchor));n.anchor=JSON.parse(JSON.stringify(candidate.match.anchor.anchor));n.anchor.onsetSource='user-confirmed-energy-candidate';n.anchor.onsetMs=candidate.atMs;candidate.confirmed=true;persist();render();};$('notes').append(confirm);}}
}

function activeRound(){const r=(state.reviewRounds||[]).filter(r=>r.status==='open').at(-1);if(!r)throw Error('Start a review round first');return r;}
function roundStatus(){const r=(state.reviewRounds||[]).at(-1);$('roundStatus').textContent=r?r.id+': '+r.status+'; '+r.responses.length+' of 2 imported responses. '+(ReviewRound.differs(r)?'Proposals differ; choose explicitly.':''):'No review round started.';}
$('beginRound').onclick=()=>{try{if(recording||recordPending)throw Error('Finish recording first');if($('draft').value!==C.current(state).text)throw Error('Save writing first');const r=ReviewRound.begin(state);if(!persist())return;$('exchange').value=JSON.stringify({...r.request,requestId:r.id,responseInstructions:'Return requestId, reviewer, versionId, versionHash and patches. No approval or publication.'},null,2);roundStatus();}catch(e){status(e.message);}};
$('cancelRound').onclick=()=>{try{ReviewRound.cancel(activeRound());persist();roundStatus();}catch(e){status(e.message);}};
function previewRound(reviewer){try{if(recording||recordPending)throw Error('Finish recording first');if($('draft').value!==C.current(state).text)throw Error('Save writing first');const r=activeRound();ReviewRound.ready(state,r);stop();ReviewRound.preview(state,r,reviewer);delete state.editorText;index=offset=0;persist();render();roundStatus();status('Local preview created. Press Read to hear it. OMS original unchanged; start a new round for further edits.');}catch(e){status(e.message);}}
$('previewClaude').onclick=()=>previewRound('Claude');$('previewZephyr').onclick=()=>previewRound('Zephyr');
roundStatus();

let journalBlocked=false;
function reduceJournal(next,e){
 const previous=state;state=next;playbackHistory=next.playbackHistory||[];applyingJournal=true;
 try{window.nativeEvent(e.type,e.value);}finally{state=previous;playbackHistory=previous.playbackHistory||[];applyingJournal=false;}
}
function haltJournal(e){journalBlocked=true;status(e.message);if(native)Native.mute();}
window.journalEvent=(seq,type,value)=>{
 if(journalBlocked)return;
 try{
  state=JournalReplay.apply(state,{seq,type,value},reduceJournal,next=>Native.save(JSON.stringify(next)));
  playbackHistory=state.playbackHistory||[];render();
 }catch(e){haltJournal(e);}
};
// Claude, 24 Oct: replay after reopening applies up to 200 events and saves once; same cursor rules as journalEvent.
window.journalBatch=events=>{
 if(journalBlocked)return;
 try{
  if(!Array.isArray(events))throw Error('Invalid journal batch');
  let next=state;
  for(const e of events){if(!Array.isArray(e)||e.length!==3)throw Error('Invalid journal batch');next=JournalReplay.apply(next,{seq:e[0],type:e[1],value:e[2]},reduceJournal,()=>true);}
  if(next!==state&&!Native.save(JSON.stringify(next)))throw Error('Journal state not saved; replay paused');
  state=next;playbackHistory=state.playbackHistory||[];render();
 }catch(e){haltJournal(e);}
};
window.replayNativeJournal=()=>{if(native&&Native.replay)Native.replay(state.lastAppliedSeq===undefined?0:state.lastAppliedSeq);};window.replayNativeJournal();
// ---- Control Room link (Claude, 24 Oct 2026). The network is reached only through Native.oms: this app's own key,
// Author' laptop over Tailscale. Load picked drafts; send notes and edited text back as one idempotent request.
const omsWaiting={};let omsSerial=0,omsWritingsList=[];
function omsTransport({method,path,body}){return new Promise((resolve,reject)=>{if(!native||!Native.oms)return reject(Error('Open Audio Writer on your phone to reach the Control Room'));const id='q'+(++omsSerial);omsWaiting[id]={resolve,reject};Native.oms(id,method,path,body===undefined?'':JSON.stringify(body));});}
function omsResult(raw){const r=JSON.parse(raw),w=omsWaiting[r.id];if(!w)return;delete omsWaiting[r.id];let body=null;try{body=r.body?JSON.parse(r.body):null;}catch(e){}
 if(r.status===401)return w.reject(Error('Audio Writer is not linked. On the Control Room phone app page, tap Link Audio Writer.'));
 if(r.status!==200)return w.reject(Error(body?.error||('Control Room unreachable'+(r.status?' ('+r.status+')':'')+'. Check Tailscale is on and the laptop is awake.')));
 w.resolve({status:200,body});}
function omsShowState(){$('omsState').textContent=native&&Native.omsLinked&&Native.omsLinked()?'Linked to your Control Room.':'Not linked yet. On the Control Room phone app page, tap Link Audio Writer.';}
async function omsShowList(){const r=await omsTransport({method:'GET',path:'/companion/v1/writings'});omsWritingsList=Array.isArray(r.body?.writings)?r.body.writings:[];const box=$('omsWritings');box.replaceChildren();
 if(!omsWritingsList.length){status('No drafts picked yet. In the Control Room, open a writing and tap Listen in Audio Writer.');return;}
 for(const w of omsWritingsList){const b=document.createElement('button');b.textContent='Load: '+w.title;b.onclick=()=>omsLoad(w).catch(e=>status(e.message));box.append(b);}
 status(omsWritingsList.length+' draft'+(omsWritingsList.length===1?'':'s')+' from the Control Room. Tap one to load it.');}
async function omsLoad(w){if(recording||recordPending)throw Error('Finish recording before loading a writing');
 const base=await OMSAdapter.create({transport:omsTransport,writingIds:[w.writingId]}).snapshot(w.writingId);
 stop();const v=C.commit(state,base.text);state.omsBases=state.omsBases||{};state.omsBases[v.id]=base;state.omsTitles=state.omsTitles||{};state.omsTitles[w.writingId]=w.title;delete state.editorText;index=offset=0;persist();render();status('Loaded "'+w.title+'". Press Read / resume to hear it.');}
// Saving carries the loaded draft's base forward to the new version, so go back to the first version on that base:
// notes recorded on the loaded text and on later saves all go with it.
function omsBaseIndex(){const B=state.omsBases||{},same=(x,y)=>x&&y&&x.writingId===y.writingId&&x.revision===y.revision;let i=state.versions.findIndex(v=>v.id===state.current);while(i>=0&&!B[state.versions[i].id])i--;if(i<0)return -1;const base=B[state.versions[i].id];while(i>0&&same(B[state.versions[i-1].id],base))i--;return i;}
async function omsSend(){
 if(recording||recordPending)throw Error('Finish recording first');
 if($('draft').value!==C.current(state).text)throw Error('Save the working copy first');
 const bi=omsBaseIndex();if(bi<0)throw Error('Load a draft from the Control Room first');
 const base=state.omsBases[state.versions[bi].id],title=state.omsTitles?.[base.writingId]||base.writingId;
 const ids=new Set(state.versions.slice(bi).map(v=>v.id));
 const request=C.packet(state);request.notes=state.notes.filter(n=>ids.has(n.anchor.versionId)).map(n=>{const o=JSON.parse(JSON.stringify(n));delete o.correctionDraft;return o;});
 if(!request.notes.length&&request.version.text===base.text)throw Error('No notes or edits to send yet');
 state.omsOutbox=state.omsOutbox||[];
 const same=state.omsOutbox.find(x=>x.payload.writingId===base.writingId&&x.payload.baseRevision===base.revision&&JSON.stringify(x.payload.request)===JSON.stringify(request));
 if(same?.receipt){status('Already sent. Record or type more notes to send again.');return;}
 const item=same||OMSOutbox.enqueue(state.omsOutbox,base,request,'aw-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));
 if(!persist())return;status('Sending…');
 const done=await OMSAdapter.create({transport:omsTransport,writingIds:[base.writingId]}).submit(item);
 const live=(state.omsOutbox||[]).find(x=>x.payload.idempotencyKey===done.payload.idempotencyKey);if(live){live.receipt=done.receipt;live.status=done.status;persist();}outboxStatus();
 status(done.status==='received'?'Sent. Your notes are beside "'+title+'" in the Control Room.':'That writing changed in the Control Room. Load it again, then send.');}
$('omsList').onclick=()=>omsShowList().catch(e=>status(e.message));
$('omsSend').onclick=()=>omsSend().catch(e=>status('Not sent: '+e.message));
const baseNativeEvent=window.nativeEvent;
window.nativeEvent=(type,value)=>{if(type==='omsResult')return omsResult(value);
 if(type==='omsOpen'){omsTakeOpen();return;}
 if(type==='omsLink'){status(value==='linked'?'Linked to your Control Room.':'Link failed: '+String(value).replace(/^error:/,''));omsShowState();if(value==='linked')omsShowList().catch(e=>status(e.message));return;}
 const r=baseNativeEvent(type,value);if(type==='transcript'||type==='recording'||type==='recorded'||type==='transcriptState'||type==='captureClosed')liveWords();return r;};
omsShowState();
// Open in Audio Writer from the Control Room: load that writing (unless it is already the one loaded at that version).
async function omsOpenWriting(id){if(recording||recordPending)throw Error('Finish the audio note first, then open it again from the Control Room');
 await omsShowList();const w=omsWritingsList.find(x=>x.writingId===id);if(!w)throw Error('That writing is not in your list. Open it again from the Control Room.');
 const bi=omsBaseIndex(),b=bi<0?null:state.omsBases[state.versions[bi].id];if(b&&b.writingId===id&&b.revision===w.revision){status('"'+w.title+'" is already loaded. Press Read / resume.');return;}
 await omsLoad(w);}
function omsTakeOpen(){const id=native&&Native.takeOpen?Native.takeOpen():'';if(id){omsOpenWriting(id).catch(e=>status(e.message));return true;}return false;}
if(!omsTakeOpen()&&native&&Native.omsLinked&&Native.omsLinked())omsShowList().catch(e=>status(e.message)); // the list fills in by itself when the app opens
// ---- Words being recorded (Claude, 24 Oct 2026): the newest audio note's words as they arrive, beside the text being read.
// Finished words in ink, the recognizer's current guess in grey. Text only; nothing here is saved or sent.
function liveWords(){const box=$('liveWords');if(!box)return;const n=state.notes.filter(x=>x.audio).at(-1);box.replaceChildren();
 const add=(text,cls)=>{const s=document.createElement('span');if(cls)s.className=cls;s.textContent=text;box.append(s);};
 if(!n){add('Press Start audio note and talk. Your words show here as you speak.','idle');return;}
 const done=(n.textSource==='user'&&n.text)?n.text:(typeof Transcript!=='undefined'?Transcript.text(n):''),guess=n.recognition?.partial||'';
 if(!done&&!guess){add(recording?'Listening…':'No words were recognised in the last note.','idle');return;}
 if(done)add(done+(guess?' ':''));if(guess)add(guess,'partial');if(box.scrollTop!==undefined)box.scrollTop=box.scrollHeight;}
{const baseRender=render;render=function(){baseRender();liveWords();};}
liveWords();
// ---- Deleting and cutting notes (Claude, 25 Oct 2026; Author: "an option to delete each block of text added from audio and
// the audio", "remove and retry", "delete ... the last thirty seconds to one minute of dictation").
// Delete moves a note and its recording aside (Restore, or Delete for good). Cut removes the last 30 or 60 seconds of a note:
// the words spoken in that time and that end of the recording, kept aside so Undo cut can put them back. While recording,
// Cut and Scrap finish the note, fix it, and start recording again. Notes already sent stay in the Control Room.
let pendingFix=null;
function noteWords(n){const t=(n.textSource==='user'&&n.text)?n.text:(n.text||(typeof Transcript!=='undefined'&&n.recognition?Transcript.text(n):'')||'');return t||(n.audio?'(audio note, no words recognised)':'(empty note)');}
function twoTap(b,label,armedLabel,act){b.textContent=label;let armed=false,timer=null;b.onclick=()=>{if(!armed){armed=true;b.textContent=armedLabel;b.classList.add('armed');timer=setTimeout(()=>{armed=false;b.textContent=label;b.classList.remove('armed');},5000);return;}if(timer)clearTimeout(timer);armed=false;act();};}
function addNoteFixControls(n){const b=document.createElement('button');b.className='quiet del';twoTap(b,'🗑 Delete this note','Tap again to delete',()=>{try{deleteNote(n.id);}catch(e){status(e.message);}});$('notes').append(b);
 if(n.cuts?.length){const u=document.createElement('button');u.className='quiet';u.textContent='↷ Undo last cut';u.onclick=()=>{try{undoCut(n.id);}catch(e){status(e.message);}};$('notes').append(u);}}
function deleteNote(id){const n=state.notes.find(x=>x.id===id);if(!n)return;
 if(n.status.startsWith('recording'))throw Error('Finish the audio note first, then delete it.');
 if(n.audio&&native&&Native.stopNotePlayback)Native.stopNotePlayback();
 state.deletedNotes=state.deletedNotes||[];state.deletedNotes.push({note:n,deletedAt:Date.now()});state.notes=state.notes.filter(x=>x.id!==id);
 if(!persist()){state.notes.push(n);state.deletedNotes.pop();return;}
 if(n.audio&&native&&Native.deleteNoteAudio&&!Native.deleteNoteAudio(n.audio))status('Note deleted, but its recording could not be moved aside.');else status('Note deleted. It is under Deleted notes if you want it back.');
 render();}
function restoreNote(id){const i=(state.deletedNotes||[]).findIndex(x=>x.note.id===id);if(i<0)return;const d=state.deletedNotes[i];
 if(!state.versions.some(v=>v.id===d.note.anchor.versionId))return status('The text this note belongs to is gone; it cannot be restored.');
 if(d.note.audio&&native&&Native.restoreNoteAudio&&!Native.restoreNoteAudio(d.note.audio))return status('The recording could not be brought back.');
 state.deletedNotes.splice(i,1);state.notes.push(d.note);state.notes.sort((a,b)=>(a.created||0)-(b.created||0));persist();render();status('Note restored.');}
function purgeNote(id){const i=(state.deletedNotes||[]).findIndex(x=>x.note.id===id);if(i<0)return;const d=state.deletedNotes[i];
 if(d.note.audio&&native&&Native.purgeNoteAudio&&!Native.purgeNoteAudio(d.note.audio))return status('The recording could not be removed.');
 state.deletedNotes.splice(i,1);persist();render();status('Deleted for good.');}
function renderDeleted(){const box=$('deletedNotes'),wrap=$('deletedBox');if(!box||!wrap)return;const list=state.deletedNotes||[];box.replaceChildren();wrap.hidden=!list.length;
 if($('deletedSummary'))$('deletedSummary').textContent='Deleted notes ('+list.length+')';
 for(const d of list){const row=document.createElement('div');row.className='gone';const p=document.createElement('p');const words=noteWords(d.note);p.textContent=(words.length>160?words.slice(0,160)+'…':words)+(d.note.anchor?.passage?' · on: '+d.note.anchor.passage.slice(0,80):'');row.append(p);
  const r=document.createElement('button');r.className='quiet';r.textContent='Restore';r.onclick=()=>restoreNote(d.note.id);row.append(r);
  const g=document.createElement('button');g.className='quiet del';twoTap(g,'Delete for good','Tap again: removes the recording',()=>purgeNote(d.note.id));row.append(g);box.append(row);}}
// words whose end time is after keepSec go; times are seconds from the start of that note's recording (Vosk word times)
function cutWords(n,keepSec){const r=n.recognition;if(!r)return;r.segments=(r.segments||[]).map(seg=>{const w=Array.isArray(seg.words)?seg.words:[];
  if(!w.length)return seg;const keep=w.filter(x=>!(Number.isFinite(x.end)&&x.end>keepSec));if(keep.length===w.length)return seg;
  if(seg.edited)return keep.length?seg:{...seg,text:''};
  return {...seg,words:keep,text:keep.map(x=>x.word).join(' ')};}).filter(seg=>String(seg.text||'').trim());r.partial='';}
function cutNote(n,seconds){if(!native||!Native.trimNoteAudio)throw Error('Cutting needs the Android app.');
 if(Native.stopNotePlayback)Native.stopNotePlayback();const raw=Native.trimNoteAudio(n.audio,seconds);if(!raw)throw Error('That recording could not be cut.');const res=JSON.parse(raw);
 if(res.kept<.5){Native.untrimNoteAudio&&Native.untrimNoteAudio(n.audio,res.tail);return deleteNote(n.id);} // the whole note was in the cut
 n.cuts=n.cuts||[];n.cuts.push({at:Date.now(),seconds,keptSec:res.kept,totalSec:res.total,tail:res.tail,before:JSON.parse(JSON.stringify(n.recognition||null)),cutoffBefore:n.cutoffSec});
 n.cutoffSec=res.kept;cutWords(n,res.kept);lastUndo={label:'cut',run:()=>undoCut(n.id)};persist();render();status('Cut the last '+(seconds>=60?'minute':seconds+' seconds')+' of that note.'+(n.textSource==='user'?' Your typed correction is unchanged.':''));}
function undoCut(id){const n=state.notes.find(x=>x.id===id);const c=n?.cuts?.at(-1);if(!c)return;
 if(native&&Native.untrimNoteAudio&&!Native.untrimNoteAudio(n.audio,c.tail))throw Error('The cut part of the recording could not be put back.');
 n.cuts.pop();n.recognition=c.before||n.recognition;if(c.cutoffBefore===undefined)delete n.cutoffSec;else n.cutoffSec=c.cutoffBefore;persist();render();status('Cut undone.');}
function lastAudioNote(){return state.notes.filter(x=>x.audio).at(-1);}
function startRecording(anchor){if(!native)return status('Recording requires Android.');if(recording||recordPending)return;recordPending=true;recordAnchor=JSON.parse(JSON.stringify(anchor));recordAnchor.onsetSource='retry';state.pendingRecordAnchor=recordAnchor;if(!persist()){recordPending=false;return;}Native.record();}
function fixNote(mode,seconds){const n=lastAudioNote();if(!n)return status('No audio note yet.');
 if(recording||n.status.startsWith('recording')){pendingFix={audio:n.audio,mode,seconds,anchor:n.anchor};holdMic();if(native)Native.mute();$('mic').textContent='Microphone closing';status(mode==='retry'?'Scrapping this note, then recording again…':'Cutting, then recording again…');return;}
 try{if(mode==='retry'){const a=n.anchor;deleteNote(n.id);startRecording(a);}else cutNote(n,seconds);}catch(e){status(e.message);}}
function runPendingFix(audio){const p=pendingFix;if(!p||p.audio!==audio)return;pendingFix=null;const n=state.notes.find(x=>x.audio===audio);if(!n)return;
 if(p.mode==='wipe'){try{wipeProgress();}catch(e){status(e.message);}return;}
 try{if(p.mode==='retry')deleteNote(n.id);else if(p.mode==='cut')cutNote(n,p.seconds);else if(p.mode==='startOver')clearForStartOver();}catch(e){status(e.message);return;}startRecording(p.anchor);if(p.resumeReading)speak();}
$('cut30').onclick=()=>fixNote('cut',30);$('cut60').onclick=()=>fixNote('cut',60);$('retry').onclick=()=>fixNote('retry',0);
{const before=window.nativeEvent;window.nativeEvent=(type,value)=>{const r=before(type,value);
 if(type==='transcript'){try{const p=JSON.parse(value),n=state.notes.find(x=>x.audio===p.audio);if(p.final&&n&&n.cutoffSec!==undefined){cutWords(n,n.cutoffSec);if(!applyingJournal)persist();liveWords();}}catch(e){}}
 if((type==='recorded'||type==='captureClosed')&&pendingFix&&pendingFix.audio===value)setTimeout(()=>runPendingFix(value),0);
 return r;};}
{const baseRender2=render;render=function(){baseRender2();renderDeleted();};}
renderDeleted();
// ---- Notes beside the writing (Claude, 25 Oct 2026; Author: "Each piece of transcript should show next to the part of writing
// where it was recorded" and "the transcript ... needs to be in blocks I can select to edit or delete"). Each finished piece of a
// spoken note goes beside the sentence playing when it began: the matched narration position for that piece if there is one,
// otherwise where the note was started. Corrected and typed notes go where the note was made. Notes on an earlier version find
// their sentence by its words; if it is gone they are listed after. Tap a block to edit or delete it. Deleting a spoken block
// removes its words (kept in the note's removedSegments); the recording stays unless the whole note is deleted.
let editingPiece=null;
function notePieces(n){const out=[];
 if(n.textSource==='user'&&n.text){out.push({text:n.text,anchor:n.anchor,kind:'corrected',nid:n.id,seg:-1});return out;}
 if(!n.audio){if(n.text)out.push({text:n.text,anchor:n.anchor,kind:'typed',nid:n.id,seg:-1});return out;}
 (n.recognition?.segments||[]).forEach((seg,i)=>{const a=seg.match?.status==='candidate'&&seg.match.anchor?.anchor?seg.match.anchor.anchor:n.anchor;if(String(seg.text||'').trim())out.push({text:seg.text,anchor:a,kind:seg.edited?'edited':'spoken',nid:n.id,seg:i});});
 if(n.recognition?.partial&&n.status.startsWith('recording'))out.push({text:n.recognition.partial,anchor:n.anchor,kind:'live',nid:n.id,seg:-2});
 return out;}
function sentenceFor(anchor,list,v){if(!anchor)return -1;
 if(anchor.versionId===v.id&&Number.isInteger(anchor.index)&&list[anchor.index])return anchor.index;
 const words=String(anchor.passage||'').trim();if(!words)return -1;let best=-1;
 list.forEach((s,i)=>{if(s.text.trim()===words&&(best<0||Math.abs(i-(anchor.index||0))<Math.abs(best-(anchor.index||0))))best=i;});return best;}
function pieceKey(p){return p.nid+'#'+p.seg;}
function savePiece(p,text){const n=state.notes.find(x=>x.id===p.nid);if(!n)return;text=String(text||'').trim();if(!text)return status('Type something, or use Delete.');
 if(p.seg>=0){const seg=n.recognition.segments[p.seg];if(seg.original===undefined)seg.original=seg.text;seg.text=text;seg.edited=true;}else C.correctNote(n,text);
 editingPiece=null;persist();render();status('Saved. The recording is unchanged.');}
function deletePiece(p){const n=state.notes.find(x=>x.id===p.nid);if(!n)return;editingPiece=null;
 if(p.seg<0)return deleteNote(n.id);
 if(n.status.startsWith('recording'))return status('Finish the audio note first.');
 const [gone]=n.recognition.segments.splice(p.seg,1);n.removedSegments=n.removedSegments||[];n.removedSegments.push({at:Date.now(),segment:gone});persist();render();status('Those words are deleted. The recording is unchanged.');}
function renderAnnotated(){const box=$('annotated');if(!box)return;box.replaceChildren();const v=C.current(state),list=C.sentences(v),by=new Map(),loose=[];
 for(const n of state.notes)for(const p of notePieces(n)){const i=sentenceFor(p.anchor,list,v);if(i<0)loose.push(p);else{if(!by.has(i))by.set(i,[]);by.get(i).push(p);}}
 const label={typed:'typed',corrected:'corrected by you',edited:'edited by you',live:'hearing…'};
 const piece=p=>{const d=document.createElement('div');d.className='apiece'+(p.kind==='typed'?' typed':p.kind==='live'?' live':'');
  if(p.kind!=='live'&&editingPiece===pieceKey(p)){d.className+=' editing';const ta=document.createElement('textarea');ta.className='short';ta.value=p.text;d.append(ta);
   const sv=document.createElement('button');sv.textContent='Save';sv.onclick=()=>{try{savePiece(p,ta.value);}catch(err){status(err.message);}};d.append(sv);
   const del=document.createElement('button');del.className='quiet del';twoTap(del,p.seg>=0?'🗑 Delete these words':'🗑 Delete this note','Tap again to delete',()=>{try{deletePiece(p);}catch(err){status(err.message);}});d.append(del);
   const cancel=document.createElement('button');cancel.className='quiet';cancel.textContent='Cancel';cancel.onclick=()=>{editingPiece=null;renderAnnotated();};d.append(cancel);return d;}
  d.textContent=p.text;if(label[p.kind]){const s=document.createElement('span');s.className='src';s.textContent=label[p.kind];d.append(s);}
  if(p.kind!=='live'){d.onclick=()=>{editingPiece=pieceKey(p);renderAnnotated();};d.title='Tap to edit or delete';}return d;};
 list.forEach((s,i)=>{const t=document.createElement('div');t.className='atext'+(by.has(i)?'':' solo')+(i===index?' now':'');t.textContent=s.text;
  t.onclick=()=>{if(playing)stop();index=i;offset=0;state.narrationCursor={versionId:state.current,index,offset};persist();render();status('Will read from sentence '+(i+1)+'. Press Read / resume.');};box.append(t);
  if(by.has(i)){const c=document.createElement('div');c.className='anotes';for(const p of by.get(i))c.append(piece(p));box.append(c);}});
 if(!list.length){const e=document.createElement('p');e.className='src';e.textContent='Load or paste a writing to see your notes beside it.';box.append(e);}
 if(loose.length){const h=document.createElement('h3');h.textContent='Notes on text that has since changed';box.append(h);for(const p of loose){const d=piece(p);const s=document.createElement('span');s.className='src';s.textContent='was on: '+String(p.anchor?.passage||'').slice(0,100);d.append(s);d.className+=' wide';box.append(d);}}}
{const baseRender3=render;render=function(){baseRender3();renderAnnotated();};}
{const before=window.nativeEvent;window.nativeEvent=(type,value)=>{const r=before(type,value);if(!editingPiece&&(type==='transcript'||type==='recorded'||type==='narrationPosition'||type==='narrationRange'))renderAnnotated();return r;};}
renderAnnotated();
// ---- Read along (Claude, 25 Oct 2026; Author: "Text being read should scroll automatically so that I can read along as I speak
// and listen"). While narrating, the edit box gives way to the same text as a reader that keeps the sentence being heard in view,
// with that sentence lit and the word being heard marked. Pause brings the edit box back. Tap a sentence to read from it.
let readerVersion=null,scrollMode=false;
function updateReader(){const box=$('reader'),ta=$('draft');if(!box||!ta)return;const on=!!playing||scrollMode;box.hidden=!on;ta.hidden=on;
 if($('draftLabel'))$('draftLabel').textContent=scrollMode?'Scroll and talk (turn it off to edit)':on?'Being read (Pause to edit)':'Being read (you can edit it)';if(!on)return;
 const v=C.current(state),list=C.sentences(v);
 if(readerVersion!==v.id||box.children.length!==list.length){box.replaceChildren();let para=null;
  list.forEach((s,i)=>{const sp=document.createElement('span');sp.className='rs'+(para!==null&&s.paragraphId!==para?' pstart':'');para=s.paragraphId;sp.textContent=s.text;
   sp.onclick=()=>{if(scrollMode){index=i;offset=0;markVisible(i);return;}stop();index=i;offset=0;speak();};box.append(sp);});readerVersion=v.id;}
 Array.from(box.children).forEach((sp,i)=>{if(i===index)return;if(sp.className.includes(' now')){sp.className=sp.className.replace(' now','');sp.textContent=list[i].text;}});
 const cur=box.children[index];if(!cur)return;const text=list[index].text,at=Math.max(0,Math.min(offset||0,text.length)),word=(text.slice(at).match(/^\s*\S+/)||[''])[0];
 if(!cur.className.includes(' now'))cur.className+=' now';cur.replaceChildren();
 const t=x=>{const s=document.createElement('span');s.textContent=x;return s;};cur.append(t(text.slice(0,at)));
 if(word){const m=document.createElement('mark');m.textContent=word;cur.append(m);}cur.append(t(text.slice(at+word.length)));
 if(playing&&Number.isFinite(cur.offsetTop)&&Number.isFinite(box.offsetTop)&&Number.isFinite(box.clientHeight))box.scrollTop=Math.max(0,cur.offsetTop-box.offsetTop-box.clientHeight/3);}
{const baseRender4=render;render=function(){baseRender4();updateReader();};}
{const baseSpeak=speak;speak=function(){baseSpeak();updateReader();};}
{const baseStop=stop;stop=function(){baseStop();updateReader();};}
{const before=window.nativeEvent;window.nativeEvent=(type,value)=>{const r=before(type,value);if(['narrationPosition','narrationRange','narrationEnded','narrationPaused','audioInterrupted','error','suspended','sessionState','done','range'].includes(type))updateReader();return r;};}
updateReader();
// ---- Scroll and talk (Claude, 25 Oct 2026; Author: "an option that doesn't read ... but lets me scroll and then listens and
// attaches my own words to the parts being read as I scroll ... use what is visible in the box"). No narration. As he scrolls, the
// sentence on the reading line (a third of the way down the box) is lit and written into the same timing history narration uses,
// on the same clock as the microphone, so each finished piece of his speech is matched to the sentence lit when he said it.
function clockNow(){return native&&Native.clockMillis?Native.clockMillis():Date.now();}
function visibleSentence(){const box=$('reader');if(!box)return index;const kids=Array.from(box.children);if(!kids.length)return -1;
 const top=Number.isFinite(box.offsetTop)?box.offsetTop:0,line=(box.scrollTop||0)+(box.clientHeight||0)/3;
 for(let i=0;i<kids.length;i++){const k=kids[i],y=(k.offsetTop||0)-top,h=k.offsetHeight||0;if(y+h>line)return i;}return kids.length-1;}
function markVisible(i){if(i<0)return;const v=C.current(state),list=C.sentences(v);if(!list[i])return;const changed=i!==index||!state.playbackHistory?.length||state.playbackHistory.at(-1).mode!=='reading'||state.playbackHistory.at(-1).anchor?.index!==i;
 index=i;offset=0;if(!changed){updateReader();return;}
 playbackHistory=state.playbackHistory||[];const at=Math.max(clockNow(),(playbackHistory.at(-1)?.atMs||0));
 playbackHistory.push({atMs:at,mode:'reading',anchor:C.anchor(state,i,0)});if(playbackHistory.length>20000)playbackHistory.shift();state.playbackHistory=playbackHistory;
 state.narrationCursor={versionId:state.current,index,offset};persist();updateReader();renderAnnotated();}
let scrollTimer=null;
function onReaderScroll(){if(!scrollMode)return;if(scrollTimer)clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{scrollTimer=null;markVisible(visibleSentence());},120);}
function setScrollMode(on){scrollMode=!!on;if(scrollMode&&playing)stop();const b=$('scrollMode');if(b){b.textContent=scrollMode?'📖 Scroll and talk is on (tap to turn off)':'📖 Scroll and talk (no reading aloud)';b.className=scrollMode?'quiet on':'quiet';}
 if($('scrollHint'))$('scrollHint').hidden=!scrollMode;const box=$('reader');if(box){box.className=scrollMode?'reader readline':'reader';box.onscroll=onReaderScroll;}
 updateReader();if(scrollMode){const cur=box&&box.children[index];if(cur&&Number.isFinite(cur.offsetTop))box.scrollTop=Math.max(0,cur.offsetTop-(box.offsetTop||0)-(box.clientHeight||0)/3);markVisible(Math.max(index,0));status('Scroll and talk: scroll to the part you are talking about, then Start audio note.');}}
$('scrollMode').onclick=()=>setScrollMode(!scrollMode);
{const baseSpeak2=speak;speak=function(){if(scrollMode)setScrollMode(false);baseSpeak2();};}
// ---- Spoken commands (Claude, 25 Oct 2026; Author: "Please make an update that works on spoken commands", for hands-free work).
// A finished piece of speech that is only a command (optionally after "writer" / "audio writer", optionally ending "please") is
// taken out of the note and acted on. Commands run only while that note is still recording and only for live events, never when
// saved events are replayed after reopening the app. Each one heard is logged on the note (note.commands) and shown on screen.
const COMMANDS=[
 ['pause',['pause','pause reading','stop reading','hold on']],
 ['resume',['keep reading','continue','continue reading','resume','read','start reading','go on','play']],
 ['back',['go back','back','go back a sentence','previous sentence','back one']],
 ['repeat',['repeat','again','read that again','say that again','repeat that']],
 ['next',['next','next sentence','skip','skip ahead']],
 ['nextPara',['next paragraph','skip paragraph']],
 ['prevPara',['previous paragraph','last paragraph','go back a paragraph']],
 ['scratch',['scratch that','delete that','strike that','remove that']],
 ['cut30',['cut thirty seconds','cut the last thirty seconds','cut last thirty seconds','cut thirty']],
 ['cut60',['cut last minute','cut the last minute','cut a minute','cut one minute']],
 ['newNote',['new note','next note']],
 ['send',['send my notes','send notes','send my notes to the control room']],
 ['startOver',['start over','start again','start from the beginning','begin again','start over from the beginning']],
 ['faster',['faster','read faster','speed up','go faster']],
 ['slower',['slower','read slower','slow down','go slower']],
 ['normalSpeed',['normal speed','normal reading speed','reset speed']],
 ['bigger',['bigger text','larger text','text bigger']],
 ['smaller',['smaller text','text smaller']],
 ['flag',['flag this','flag that','flag this sentence','mark this','bookmark this']],
 ['readBack',['read that back','read back','read my last note','what did i say']],
 ['undo',['undo that','undo','put that back']]];
function commandIn(text){let t=String(text||'').toLowerCase().replace(/[^a-z ]+/g,' ').replace(/\s+/g,' ').trim();
 t=t.replace(/^(okay |ok )?(audio )?writer /,'').replace(/ please$/,'').trim();for(const [cmd,phrases] of COMMANDS)if(phrases.includes(t))return cmd;return null;}
let replayingBatch=false;
{const baseBatch=window.journalBatch;window.journalBatch=events=>{replayingBatch=true;try{return baseBatch(events);}finally{replayingBatch=false;}};}
function heard(cmd,said){const label={pause:'Paused',resume:'Reading',back:'Back one sentence',repeat:'Repeating',next:'Next sentence',nextPara:'Next paragraph',prevPara:'Previous paragraph',scratch:'Scratched',cut30:'Cutting 30 seconds',cut60:'Cutting a minute',newNote:'New note',send:'Sending notes',startOver:'Starting over',faster:'Faster',slower:'Slower',normalSpeed:'Normal speed',bigger:'Bigger text',smaller:'Smaller text',flag:'Flagged',readBack:'Reading it back',undo:'Undone'}[cmd]||cmd;
 if(native&&Native.tone)Native.tone(cmd==='startOver'||cmd==='newNote'?'big':'ok');
 status('Heard “'+said+'”: '+label+'.');if($('lastCommand'))$('lastCommand').textContent='Last command: “'+said+'” ('+label+')';}
function moveTo(i){const list=C.sentences(C.current(state));if(!list.length)return;const was=playing;if(was)stop();index=Math.max(0,Math.min(list.length-1,i));offset=0;
 state.narrationCursor={versionId:state.current,index,offset};persist();render();if(was)speak();}
function paragraphStart(dir){const list=C.sentences(C.current(state));if(!list.length)return 0;const here=list[Math.min(index,list.length-1)].paragraphId;
 if(dir>0){let i=index;while(i<list.length&&list[i].paragraphId===here)i++;return Math.min(i,list.length-1);}
 let i=index;while(i>0&&list[i-1].paragraphId===here)i--;if(i===0)return 0;const prev=list[i-1].paragraphId;i--;while(i>0&&list[i-1].paragraphId===prev)i--;return i;}
function scratchLast(audio){const n=state.notes.find(x=>x.audio===audio)||lastAudioNote();const pool=n&&n.recognition?.segments?.length?n:state.notes.filter(x=>x.audio&&x.recognition?.segments?.length).at(-1);
 if(!pool)return status('Nothing to scratch yet.');const [gone]=pool.recognition.segments.splice(pool.recognition.segments.length-1,1);
 pool.removedSegments=pool.removedSegments||[];pool.removedSegments.push({at:Date.now(),segment:gone,by:'spoken command'});persist();render();liveWords();
 lastUndo={label:'scratch',run:()=>{const i=pool.removedSegments.findIndex(r=>r.segment===gone);if(i>=0)pool.removedSegments.splice(i,1);pool.recognition.segments.push(gone);}};}
function runCommand(cmd,audio){
 if(cmd==='pause'){if(playing)stop();return;}
 if(cmd==='resume'){if(!playing)speak();return;}
 if(cmd==='back')return moveTo(index-1);
 if(cmd==='repeat')return moveTo(index);
 if(cmd==='next')return moveTo(index+1);
 if(cmd==='nextPara')return moveTo(paragraphStart(1));
 if(cmd==='prevPara')return moveTo(paragraphStart(-1));
 if(cmd==='scratch')return scratchLast(audio);
 if(cmd==='cut30')return fixNote('cut',30);
 if(cmd==='cut60')return fixNote('cut',60);
 if(cmd==='newNote'){const n=state.notes.find(x=>x.audio===audio);if(n&&n.status.startsWith('recording')){pendingFix={audio,mode:'new',anchor:C.anchor(state,index,offset)};holdMic();if(native)Native.mute();}return;}
 if(cmd==='send')return omsSend().catch(e=>status('Not sent: '+e.message));
 if(cmd==='startOver')return startOver();
 if(cmd==='faster')return changeSpeed(1.1);if(cmd==='slower')return changeSpeed(1/1.1);if(cmd==='normalSpeed')return setSpeed(DEFAULT_RATE);
 if(cmd==='bigger')return changeText(1.15);if(cmd==='smaller')return changeText(1/1.15);
 if(cmd==='flag')return flagSentence();if(cmd==='readBack')return readBack();if(cmd==='undo')return undoLast();}
{const before=window.nativeEvent;window.nativeEvent=(type,value)=>{const r=before(type,value);
 if(type==='transcript'){try{const p=JSON.parse(value);if(p.final){const n=state.notes.find(x=>x.audio===p.audio),segs=n?.recognition?.segments;const last=segs?.at(-1);const said=String(p.result?.text||'').trim();
  const cmd=last&&last.text===said?commandIn(said):null;
  if(cmd){segs.pop();n.commands=n.commands||[];n.commands.push({at:Date.now(),said,cmd});if(!applyingJournal)persist();liveWords();if(!replayingBatch&&n.status.startsWith('recording')){heard(cmd,said);setTimeout(()=>runCommand(cmd,p.audio),0);}}}}catch(e){}}
 return r;};}
// ---- Start over (Claude, 25 Oct 2026; Author: "add start over as an option for both verbal instructions and a button. It starts over
// the entire reading and dictation."). Reading goes back to the first sentence. Every note on this writing (the versions since it
// was loaded, or the current text if it was pasted) moves to Deleted notes with its recording, so Restore still brings any back.
// If a note is recording it is finished first and a fresh note starts at the first sentence; if it was reading, it reads from the top.
// Notes already sent stay in the Control Room.
function writingVersionIds(){const bi=omsBaseIndex();return new Set(bi>=0?state.versions.slice(bi).map(v=>v.id):[state.current]);}
function clearForStartOver(){const ids=writingVersionIds(),keep=[],gone=[];
 for(const n of state.notes)(ids.has(n.anchor?.versionId)&&!n.status.startsWith('recording')?gone:keep).push(n);
 if(gone.length&&native&&Native.stopNotePlayback)Native.stopNotePlayback();
 state.deletedNotes=state.deletedNotes||[];for(const n of gone){state.deletedNotes.push({note:n,deletedAt:Date.now(),reason:'start over'});if(n.audio&&native&&Native.deleteNoteAudio)Native.deleteNoteAudio(n.audio);}
 state.notes=keep;index=0;offset=0;state.narrationCursor={versionId:state.current,index,offset};editingPiece=null;persist();render();
 status('Started over: back to the first sentence. '+(gone.length?gone.length+' note'+(gone.length===1?'':'s')+' moved to Deleted notes.':'There were no notes yet.'));}
function startOver(){const was=playing;if(playing)stop();if(scrollMode)setScrollMode(false);
 const rec=state.notes.find(n=>n.audio&&n.status.startsWith('recording'));
 if(rec||recording){if(rec){pendingFix={audio:rec.audio,mode:'startOver',anchor:C.anchor(state,0,0),resumeReading:was};holdMic();if(native)Native.mute();$('mic').textContent='Microphone closing';status('Starting over…');return;}}
 clearForStartOver();if(was)speak();}
{const b=$('startOver');if(b)twoTap(b,'⟲ Start over','Tap again: start over',()=>{try{startOver();}catch(e){status(e.message);}});}
// ---- One Start button, Stop, Back/Next, Delete all progress (Claude, 25 Oct 2026; Author: "The start reading and start audio should
// be the same button please. Also there should be a button to delete all current progress.").
// Start: recording and reading together (in Scroll and talk, recording only). Stop: ends the reading and finishes the note.
// Back/Next: one sentence, like the spoken commands. Delete all progress (two taps): this writing's notes and their recordings,
// including any in Deleted notes, are removed for good and reading goes back to the first sentence. The text and its versions stay.
function startAll(){if($('draft').value!==C.current(state).text)return status('Save your working copy first.');
 if(!recording&&!recordPending)$('record').onclick();if(!scrollMode&&!playing)$('play').onclick();showRunning();}
function stopAll(){if(playing)stop();if(recording||recordPending){if(native)Native.mute();$('mic').textContent='Microphone closing';}status('Stopped. Your note is kept.');showRunning();}
function showRunning(){const b=$('startAll');if(!b)return;const on=recording||recordPending||playing;b.textContent=on?(playing?'● Reading and recording':'● Recording'):'▶ Start';b.className=on?'start running':'start';}
function wipeProgress(){const ids=writingVersionIds();const mine=n=>ids.has(n.anchor?.versionId);
 const notes=state.notes.filter(n=>mine(n)&&!n.status.startsWith('recording')),trashed=(state.deletedNotes||[]).filter(d=>mine(d.note));
 if(native&&Native.stopNotePlayback)Native.stopNotePlayback();
 for(const n of notes)if(n.audio&&native){if(Native.deleteNoteAudio)Native.deleteNoteAudio(n.audio);if(Native.purgeNoteAudio)Native.purgeNoteAudio(n.audio);}
 for(const d of trashed)if(d.note.audio&&native&&Native.purgeNoteAudio)Native.purgeNoteAudio(d.note.audio);
 state.notes=state.notes.filter(n=>!notes.includes(n));state.deletedNotes=(state.deletedNotes||[]).filter(d=>!trashed.includes(d));
 index=0;offset=0;state.narrationCursor={versionId:state.current,index,offset};editingPiece=null;persist();render();showRunning();
 status('Deleted all progress on this writing: '+(notes.length+trashed.length)+' note'+(notes.length+trashed.length===1?'':'s')+' and their recordings. The text is kept.');}
function deleteAllProgress(){if(playing)stop();if(scrollMode)setScrollMode(false);const rec=state.notes.find(n=>n.audio&&n.status.startsWith('recording'));
 if(rec){pendingFix={audio:rec.audio,mode:'wipe'};if(native)Native.mute();$('mic').textContent='Microphone closing';status('Finishing the note, then deleting all progress…');return;}
 wipeProgress();}
$('startAll').onclick=startAll;$('stopAll').onclick=stopAll;
$('prevSentence').onclick=()=>moveTo(index-1);$('nextSentence').onclick=()=>moveTo(index+1);
twoTap($('wipe'),'🗑 Delete all progress','Tap again: deletes this writing\'s notes and recordings for good',()=>{try{deleteAllProgress();}catch(e){status(e.message);}});
{const baseRender5=render;render=function(){baseRender5();showRunning();};}
{const before=window.nativeEvent;window.nativeEvent=(type,value)=>{const r=before(type,value);if(['recording','recorded','captureClosed','recordError','narrationPosition','narrationEnded','narrationPaused','audioInterrupted','sessionState'].includes(type))showRunning();return r;};}
{const baseSpeak3=speak;speak=function(){baseSpeak3();showRunning();};const baseStop3=stop;stop=function(){baseStop3();showRunning();};}
showRunning();
// ---- Speed, text size, flag, read back, undo, sounds, no one-hour limit (Claude, 25 Oct 2026; Author: "Please add all of your
// suggestions"). Speed and text size are kept in the saved session. A flag is a typed note on the sentence. Read back speaks the last
// piece of words outside the narration; whatever the microphone hears during it is set aside, not saved as notes. Undo takes back the
// last scratch, cut or flag. Spoken commands give a short beep (two for start over and new note). At the one-hour limit the note
// finishes and the next one starts by itself; holdMic keeps Android from refusing the restart while the screen is off.
const DEFAULT_RATE=1.305;let lastUndo=null,asideActive=false,asideResume=false;
function holdMic(){if(native&&Native.keepMicrophone)Native.keepMicrophone(15);}
function speedLabel(){const r=state.readingRate||DEFAULT_RATE;if($('speedLabel'))$('speedLabel').textContent='Speed '+Math.round(r/DEFAULT_RATE*100)+'%';}
function setSpeed(r){r=Math.max(.5,Math.min(2.5,Math.round(r*1000)/1000));state.readingRate=r;persist();speedLabel();if(native&&Native.setReadingRate)Native.setReadingRate(r);
 if(playing){stop();speak();}status('Reading speed '+Math.round(r/DEFAULT_RATE*100)+'%.');}
function changeSpeed(f){setSpeed((state.readingRate||DEFAULT_RATE)*f);}
function applyText(){const s=state.textScale||1;try{document.documentElement.style.setProperty('--text-scale',String(s));}catch(e){}}
function changeText(f){state.textScale=Math.max(.7,Math.min(2.2,Math.round((state.textScale||1)*f*100)/100));persist();applyText();status('Text size '+Math.round(state.textScale*100)+'%.');}
function flagSentence(){const list=C.sentences(C.current(state));if(!list.length)return status('Load a writing first.');const n=C.note(state,C.anchor(state,Math.min(index,list.length-1),0),'⚑ Flagged to come back to');
 n.flag=true;persist();render();lastUndo={label:'flag',run:()=>{state.notes=state.notes.filter(x=>x!==n);}};status('Flagged sentence '+(Math.min(index,list.length-1)+1)+'.');}
function lastWords(){for(const n of [...state.notes].reverse()){if(n.flag)continue;const segs=n.recognition?.segments||[];if(n.textSource!=='user'&&segs.length)return segs.at(-1).text;if(n.text)return n.text;}return '';}
function readBack(){const t=lastWords();if(!t)return status('Nothing to read back yet.');if(!native||!Native.speakAside)return status('Read back needs the Android app.');
 asideResume=playing;if(playing)stop();asideActive=true;status('Reading back: '+t);Native.speakAside(t);}
function undoLast(){const u=lastUndo;if(!u)return status('Nothing to undo.');lastUndo=null;try{u.run();persist();render();liveWords();status('Undone ('+u.label+').');}catch(e){status(e.message);}}
$('faster').onclick=()=>changeSpeed(1.1);$('slower').onclick=()=>changeSpeed(1/1.1);
$('textBigger').onclick=()=>changeText(1.15);$('textSmaller').onclick=()=>changeText(1/1.15);
$('flag').onclick=flagSentence;$('readBack').onclick=readBack;$('undoLast').onclick=undoLast;
{const before=window.nativeEvent;window.nativeEvent=(type,value)=>{
 let n=null,count=0;if(type==='transcript'&&asideActive){try{const p=JSON.parse(value);n=state.notes.find(x=>x.audio===p.audio);count=n?.recognition?.segments?.length||0;}catch(e){}}
 const r=before(type,value);
 if(n&&asideActive){const segs=n.recognition?.segments||[];while(segs.length>count){const gone=segs.pop();n.removedSegments=n.removedSegments||[];n.removedSegments.push({at:Date.now(),segment:gone,by:'heard during read-back'});}if(!applyingJournal)persist();}
 if(type==='asideDone'){asideActive=false;if(asideResume){asideResume=false;speak();}}
 if(type==='captureLimit'){const note=state.notes.find(x=>x.audio===value);if(note){pendingFix={audio:value,mode:'continue',anchor:C.anchor(state,index,offset)};holdMic();status('An hour recorded: starting the next note.');}}
 return r;};}
speedLabel();applyText();if(native&&Native.setReadingRate&&state.readingRate)Native.setReadingRate(state.readingRate);
