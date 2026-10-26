// Explicit offline review rounds. Names in imported packets are unauthenticated claims.

(function(root){

const C=typeof module!=='undefined'?require('./core.js'):root.Core;

const copy=x=>JSON.parse(JSON.stringify(x));

function begin(s){const request=copy(C.packet(s));if(request.notes.some(n=>n.status.startsWith('recording')))throw Error('Finish or recover the recording first');const r={id:'review-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),request,responses:[],status:'open'};s.reviewRounds=s.reviewRounds||[];for(const old of s.reviewRounds)if(old.status==='open')old.status='superseded';s.reviewRounds.push(r);return r;}

function live(s,r){if(r.status!=='open')throw Error('Review round is closed');if(JSON.stringify(C.packet(s))!==JSON.stringify(r.request))throw Error('Writing or notes changed; start a new review round');}

function receive(s,r,p){live(s,r);if(!p||p.requestId!==r.id)throw Error('Response belongs to another round');const raw=copy(p);delete raw.requestId;const valid=C.validate(s,raw);const old=r.responses.find(x=>x.reviewer===valid.reviewer);if(old){if(JSON.stringify(old)!==JSON.stringify(valid))throw Error('Reviewer response changed; start a new round');return old;}r.responses.push(valid);return valid;}

function ready(s,r){live(s,r);if(new Set(r.responses.map(p=>p.reviewer)).size!==2)throw Error('Both reviewer responses are required');for(const p of r.responses)C.validate(s,p);return true;}

function differs(r){return r.responses.length===2&&JSON.stringify(r.responses[0].patches)!==JSON.stringify(r.responses[1].patches);}

function preview(s,r,reviewer){ready(s,r);const p=r.responses.find(p=>p.reviewer===reviewer);if(!p)throw Error('Choose a reviewer proposal');const old=C.current(s),base=s.omsBases?.[old.id];const v=C.accept(s,p);v.localPreview={requestId:r.id,reviewer,sourceVersionId:old.id};if(base)s.omsBases[v.id]=copy(base);r.status='previewed';return v;}

function cancel(r){if(r.status!=='open')throw Error('Round is closed');r.status='cancelled';}

const api={begin,live,receive,ready,differs,preview,cancel};if(typeof module!=='undefined')module.exports=api;else root.ReviewRound=api;

})(typeof window!=='undefined'?window:this);

