(function(root){
function apply(state,event,reduce,save){
 if(!event||!Number.isSafeInteger(event.seq)||event.seq<1||typeof event.type!=='string'||typeof event.value!=='string')throw Error('Invalid journal event');
 const cursor=state.lastAppliedSeq===undefined?0:state.lastAppliedSeq;
 if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid journal cursor');
 if(event.seq<=cursor)return state;if(event.seq!==cursor+1)throw Error('Journal gap; replay required');
 const next=JSON.parse(JSON.stringify(state));reduce(next,event);next.lastAppliedSeq=event.seq;
 if(!save(next))throw Error('Journal state not saved; replay paused');return next;
}
const api={apply};if(typeof module!=='undefined')module.exports=api;else root.JournalReplay=api;
})(typeof window!=='undefined'?window:this);
