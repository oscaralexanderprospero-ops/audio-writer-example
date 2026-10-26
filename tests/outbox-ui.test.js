const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

const C=require('../app/src/main/assets/core.js'),O=require('../app/src/main/assets/oms-outbox.js');

test('UI keeps canonical base across edits and persistent export retries',()=>{

 const elements={};function el(){return {value:'',textContent:'',children:[],replaceChildren(){this.children=[];},append(x){this.children.push(x);}};}

 let saved='';const ctx={Core:C,OMSOutbox:O,document:{getElementById:id=>elements[id]||(elements[id]=el()),querySelectorAll:()=>[],createElement:el},Native:{load:()=>'',save:x=>(saved=x,true),stop(){},speak(){},record(){},mute(){},stopNotePlayback(){}},window:{}};

 vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/src/main/assets/ui.js','utf8'),ctx);

 ctx.document.getElementById('exchange').value=JSON.stringify({schema:1,kind:'oms-writing-snapshot',writingId:'w1',revision:'r1',text:'Original.'});elements.loadOms.onclick();

 elements.draft.value='Changed locally.';elements.save.onclick();ctx.document.getElementById('note').value='Keep the tone';elements.add.onclick();elements.queueOms.onclick();

 const first=JSON.parse(elements.exchange.value);assert.equal(first.baseRevision,'r1');assert.equal(first.baseText,'Original.');assert.equal(first.request.version.text,'Changed locally.');assert.equal(first.request.notes[0].text,'Keep the tone');

 elements.queueOms.onclick();assert.equal(JSON.parse(elements.exchange.value).idempotencyKey,first.idempotencyKey);assert.equal(JSON.parse(saved).omsOutbox.length,1);

 elements.exchange.value=JSON.stringify({schema:1,kind:'oms-edit-review-receipt',idempotencyKey:first.idempotencyKey,writingId:'w1',baseRevision:'r1',status:'conflict',currentRevision:'r2'});elements.receiptOms.onclick();assert.equal(C.current(JSON.parse(saved)).text,'Changed locally.');assert.equal(JSON.parse(saved).omsOutbox[0].status,'conflict');

});

