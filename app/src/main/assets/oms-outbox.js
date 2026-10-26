// Offline protocol draft. No transport, authentication, approval or publication.
(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
function fields(x,keys){if(!x||Array.isArray(x)||typeof x!=='object'||Object.keys(x).some(k=>!keys.includes(k)))throw Error('Unexpected packet fields');}
function id(x){return typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);}
function snapshot(x){fields(x,['schema','kind','writingId','revision','text']);if(x.schema!==1||x.kind!=='oms-writing-snapshot'||!id(x.writingId)||!id(x.revision)||typeof x.text!=='string'||x.text.length>1000000)throw Error('Invalid OMS snapshot');return copy(x);}
function enqueue(box,base,request,key){base=snapshot(base);if(!id(key)||request?.kind!=='review-request'||request.schema!==1||typeof request.version?.text!=='string'||!Array.isArray(request.notes))throw Error('Invalid review request');
 const payload={schema:1,kind:'oms-edit-review-request',idempotencyKey:key,writingId:base.writingId,baseRevision:base.revision,baseText:base.text,request:copy(request)};
 if(JSON.stringify(payload).length>4000000)throw Error('Request too large');
 const old=box.find(x=>x.payload.idempotencyKey===key);if(old){if(JSON.stringify(old.payload)!==JSON.stringify(payload))throw Error('Idempotency key reused with different content');return old;}
 const item={payload,status:'queued',receipt:null};box.push(item);return item;
}
function acknowledge(item,r){fields(r,['schema','kind','idempotencyKey','writingId','baseRevision','status','reviewId','currentRevision']);
 if(r.schema!==1||r.kind!=='oms-edit-review-receipt'||r.idempotencyKey!==item.payload.idempotencyKey||r.writingId!==item.payload.writingId||r.baseRevision!==item.payload.baseRevision)throw Error('Receipt does not match queued request');
 if(r.status==='received'){if(!id(r.reviewId)||r.currentRevision!==undefined)throw Error('Invalid review receipt');}
 else if(r.status==='conflict'){if(!id(r.currentRevision)||r.reviewId!==undefined)throw Error('Invalid conflict receipt');}
 else throw Error('Receipt cannot approve or publish');
 if(item.receipt){if(JSON.stringify(item.receipt)!==JSON.stringify(r))throw Error('Contradictory receipt');return;}
 item.receipt=copy(r);item.status=r.status; // received means queued at OMS, never approved
}
function restore(box){if(!Array.isArray(box)||box.length>1000)throw Error('Invalid outbox');let result=[];for(const item of box){fields(item,['payload','status','receipt']);const p=item.payload;fields(p,['schema','kind','idempotencyKey','writingId','baseRevision','baseText','request']);if(p.schema!==1||p.kind!=='oms-edit-review-request')throw Error('Invalid request');if(result.some(x=>x.payload.idempotencyKey===p.idempotencyKey))throw Error('Duplicate outbox key');const fresh=enqueue(result,{schema:1,kind:'oms-writing-snapshot',writingId:p.writingId,revision:p.baseRevision,text:p.baseText},p.request,p.idempotencyKey);if(item.receipt)acknowledge(fresh,item.receipt);if(fresh.status!==item.status)throw Error('Corrupt outbox state');}return result;}
const api={snapshot,enqueue,acknowledge,restore};if(typeof module!=='undefined')module.exports=api;else root.OMSOutbox=api;
})(typeof window!=='undefined'?window:this);
