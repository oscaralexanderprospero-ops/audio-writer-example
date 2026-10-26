const t=require('node:test'),a=require('node:assert/strict'),A=require('../app/src/main/assets/oms-adapter.js'),O=require('../app/src/main/assets/oms-outbox.js'),C=require('../app/src/main/assets/core.js');

function item(){const s=C.fresh();C.commit(s,'Original.');return O.enqueue([],{schema:1,kind:'oms-writing-snapshot',writingId:'W1',revision:'r1',text:'Original.'},C.packet(s),'key-1');}

function receipt(p){return {schema:1,kind:'oms-edit-review-receipt',idempotencyKey:p.idempotencyKey,writingId:p.writingId,baseRevision:p.baseRevision,status:'received',reviewId:'R1'};}

t('adapter is unconfigured by default and scope checked before any transport',async()=>{await a.rejects(A.create({writingIds:['W1']}).snapshot('W1'),/unconfigured/);let calls=0;await a.rejects(A.create({transport:()=>calls++,writingIds:['W1']}).snapshot('W2'),/scope/);a.equal(calls,0);});

t('uncertain send retries exact immutable payload; caller state changes only after validated receipt',async()=>{const queued=item(),original=JSON.stringify(queued),requests=[];const adapter=A.create({writingIds:['W1'],transport:async r=>{requests.push(r);if(requests.length===1)throw Error('connection lost');return {status:200,body:receipt(r.body)};}});await a.rejects(adapter.submit(queued));a.equal(JSON.stringify(queued),original);const received=await adapter.submit(queued);a.deepEqual(requests[0],requests[1]);a.equal(received.status,'received');a.equal(JSON.stringify(queued),original);await adapter.submit(received);a.equal(requests.length,2);});

t('wrong snapshot, publishing receipt, redirect and HTTP errors never become success',async()=>{const queued=item();for(const response of [{status:302,body:{}},{status:500,body:{}},{status:200,body:{...receipt(queued.payload),status:'published'}}])await a.rejects(A.create({writingIds:['W1'],transport:async()=>response}).submit(queued));await a.rejects(A.create({writingIds:['W1'],transport:async()=>({status:200,body:{schema:1,kind:'oms-writing-snapshot',writingId:'W2',revision:'r1',text:''}})}).snapshot('W1'),/Wrong writing/);a.equal(queued.status,'queued');});

