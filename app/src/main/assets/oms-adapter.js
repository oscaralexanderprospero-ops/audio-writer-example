// Proposed companion contract only. No built-in networking, credentials or model calls.

(function(root){

'use strict';

const O=typeof module!=='undefined'?require('./oms-outbox.js'):root.OMSOutbox;

const clone=x=>JSON.parse(JSON.stringify(x));

function create({transport=null,writingIds=[]}={}){

 const allowed=new Set(writingIds);

 function scoped(id){if(typeof id!=='string'||!allowed.has(id))throw Error('Writing outside companion scope');return encodeURIComponent(id);}

 async function call(method,path,body){if(typeof transport!=='function')throw Error('OMS transport unconfigured');const response=await transport({method,path,body:body===undefined?undefined:clone(body),redirect:'error'});if(!response||response.status!==200||!response.body)throw Error('OMS request failed; retry only with unchanged request');return clone(response.body);}

 return Object.freeze({

  async snapshot(id){const path=scoped(id),r=O.snapshot(await call('GET','/companion/v1/writings/'+path));if(r.writingId!==id)throw Error('Wrong writing returned');return r;},

  async submit(item){const frozen=O.restore([clone(item)])[0];scoped(frozen.payload.writingId);if(frozen.receipt)return frozen;const r=await call('POST','/companion/v1/edit-requests',frozen.payload);O.acknowledge(frozen,r);return frozen;}

 });

}

const api={create};if(typeof module!=='undefined')module.exports=api;else root.OMSAdapter=api;

})(typeof window!=='undefined'?window:this);

