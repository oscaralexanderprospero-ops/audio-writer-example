(function(root){

function receive(note,p,history){if(!p||p.audio!==note.audio||typeof p.final!=='boolean'||!p.result)throw Error('Wrong transcript target');const text=p.result[p.final?'text':'partial'];if(typeof text!=='string'||text.length>100000)throw Error('Invalid recognition text');const r=note.recognition||(note.recognition={engine:'Vosk offline',segments:[],partial:''});if(!p.final){r.partial=text;return;}

 r.partial='';if(!text.trim())return;const words=p.result.result||[];if(!Array.isArray(words))throw Error('Invalid word timing');let onset=null;if(words.length&&Number.isFinite(words[0].start)&&words[0].start>=0&&Number.isFinite(p.originMs))onset=p.originMs+words[0].start*1000;

 const H=typeof module!=='undefined'?require('./onset-history.js'):root.OnsetHistory;r.segments.push({text,words:JSON.parse(JSON.stringify(words)),onsetMs:onset,match:onset===null?{status:'unanchored'}:H.atOnset(history,onset),requiresConfirmation:true});

}

function text(note){return (note.recognition?.segments||[]).map(s=>s.text).join(' ');}

function terminal(note,p){if(!p||p.audio!==note.audio||typeof p.complete!=='boolean'||typeof p.reason!=='string')throw Error('Invalid transcript completion');const r=note.recognition||(note.recognition={engine:'Vosk offline',segments:[],partial:''});r.complete=p.complete;r.reason=p.reason;note.status=p.complete?'recorded - transcript ready for correction':'recorded - transcript incomplete: '+p.reason;}

const api={receive,text,terminal};if(typeof module!=='undefined')module.exports=api;else root.Transcript=api;

})(typeof window!=='undefined'?window:this);

