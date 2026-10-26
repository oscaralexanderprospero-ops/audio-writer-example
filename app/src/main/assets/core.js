(function(root){

const uid=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);

// Hash is a deterministic stale-content guard, not a security signature.

function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}

function segment(text){let out=[]; let re=/[^\n]+/g,m;while((m=re.exec(text))){let p={id:uid(),text:m[0],start:m.index,sentences:[]};let sr=/[^.!?]+(?:[.!?]+|$)/g,s;while((s=sr.exec(p.text))){if(s[0].trim())p.sentences.push({id:uid(),text:s[0],start:p.start+s.index});}out.push(p);}return out;}

function version(text,prior){let paragraphs=segment(text),old=prior?.paragraphs||[];paragraphs.forEach((p,i)=>{if(old[i]?.text===p.text)p.id=old[i].id;});return {id:uid(),hash:hash(text),text,paragraphs};}

function fresh(){let v=version('');return {schema:1,versions:[v],current:v.id,notes:[],proposals:[],cursor:0};}

function current(s){return s.versions.find(v=>v.id===s.current);}

function sentences(v){return v.paragraphs.flatMap(p=>p.sentences.map(x=>({...x,paragraphId:p.id})));}

function commit(s,text){let v=version(text,current(s));s.versions.push(v);s.current=v.id;s.cursor=0;return v;}

function anchor(s,index,offset=0){let v=current(s),a=sentences(v),x=a[index];return {versionId:v.id,versionHash:v.hash,sentenceId:x?.id||null,paragraphId:x?.paragraphId||null,index,offset:Math.max(0,Math.min(offset,x?.text.length||0)),previous:a[index-1]||null,passage:x?.text||'',onset:Date.now()};}

function note(s,a,text,audio=null){let n={id:uid(),anchor:a,text,audio,status:audio?'recorded — transcription unavailable':'manual',created:Date.now()};s.notes.push(n);return n;}

function correctNote(n,text){if(typeof text!=='string'||text.length>100000)throw Error('Invalid correction');n.corrections=n.corrections||[];if(n.corrections.length>=100)throw Error('Correction history limit reached');n.corrections.push({text:n.text,source:n.textSource||'unspecified',at:Date.now()});n.text=text;n.textSource='user';n.textConfirmed=true;delete n.correctionDraft;}

function recoverInterrupted(s){let changed=false;for(const n of s.notes){if(n.status?.startsWith('recording')){n.status='interrupted - recording completeness unverified';changed=true;}}return changed;}

function packet(s){return {schema:1,kind:'review-request',reviewers:['Zephyr','Claude'],version:current(s),notes:s.notes.filter(n=>n.anchor.versionId===s.current).map(n=>{const out=JSON.parse(JSON.stringify(n));delete out.correctionDraft;return out;}),rules:['Return proposals only','No publication','Preserve intent; ask about ambiguous references']};}

function exact(o,keys){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))throw Error('Unexpected fields');}

function resumeOffset(base,relative,length){if(!Number.isInteger(base)||!Number.isInteger(relative)||relative<0)return Math.max(0,Math.min(base||0,length));return Math.max(0,Math.min(base+relative,length));}

function validate(s,p){let v=current(s);exact(p,['reviewer','versionId','versionHash','patches']);if(!['Zephyr','Claude'].includes(p.reviewer)||p.versionId!==v.id||p.versionHash!==v.hash||!Array.isArray(p.patches)||p.patches.length>500)throw Error('Unknown reviewer or stale/invalid version');let end=-1,lastStart=-1,total=0;for(let x of p.patches){exact(x,['start','end','before','text']);if(!Number.isInteger(x.start)||!Number.isInteger(x.end)||x.start<0||x.end<x.start||x.end>v.text.length||x.start<end||x.start===lastStart||typeof x.text!=='string'||typeof x.before!=='string'||x.before!==v.text.slice(x.start,x.end))throw Error('Invalid, overlapping or stale patch');total+=x.text.length;if(total>1000000)throw Error('Proposal too large');end=x.end;lastStart=x.start;}return JSON.parse(JSON.stringify(p));}

function accept(s,p){validate(s,p);let t=current(s).text;for(let x of [...p.patches].reverse())t=t.slice(0,x.start)+x.text+t.slice(x.end);return commit(s,t);}

function restore(raw){let s=JSON.parse(raw);if(s.schema!==1||!Array.isArray(s.versions)||!Array.isArray(s.notes)||!Array.isArray(s.proposals)||!current(s))throw Error('Invalid save');for(let v of s.versions)if(hash(v.text)!==v.hash)throw Error('Corrupt version');for(let n of s.notes){let v=s.versions.find(v=>v.id===n.anchor?.versionId);if(!v||n.anchor.versionHash!==v.hash||typeof n.text!=='string'||(n.audio!==null&&(typeof n.audio!=='string'||!/^note-[0-9]+\.(?:m4a|wav)$/.test(n.audio))))throw Error('Corrupt note');}return s;}

const api={correctNote,recoverInterrupted,hash,resumeOffset,segment,version,fresh,current,sentences,commit,anchor,note,packet,validate,accept,restore};if(typeof module!=='undefined')module.exports=api;else root.Core=api;

})(typeof window!=='undefined'?window:this);

