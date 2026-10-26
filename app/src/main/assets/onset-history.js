// Playback-history mapping for a future native PCM/VAD adapter.
// Caller supplies one monotonic clock domain. No wall-clock/recognition-completion anchoring.
(function(root){
function atOnset(history,onsetMs){
 if(!Number.isFinite(onsetMs)||!Array.isArray(history))throw Error('Invalid clock/history');
 let selected=null,previous=null,last=-Infinity;
 for(const event of history){if(!Number.isFinite(event.atMs)||event.atMs<last)throw Error('Unordered playback history');last=event.atMs;if(event.atMs>onsetMs)break;previous=selected;selected=event;}
 if(!selected)return {status:'unanchored',reason:'onset precedes retained history'};
 return {status:'candidate',anchor:JSON.parse(JSON.stringify(selected)),previous:previous?JSON.parse(JSON.stringify(previous)):null,onsetMs,requiresConfirmation:true};
}
const api={atOnset};if(typeof module!=='undefined')module.exports=api;else root.OnsetHistory=api;
})(typeof window!=='undefined'?window:this);

