const t=require('node:test'),a=require('node:assert/strict'),T=require('../app/src/main/assets/transcript.js');

t('partial is provisional, final retains timing and never overwrites manual correction',()=>{let n={audio:'note-1.wav',text:'My correction',textSource:'user'};const base={audio:n.audio,originMs:1000};T.receive(n,{...base,final:false,result:{partial:'change'}},[]);a.equal(T.text(n),'');T.receive(n,{...base,final:true,result:{text:'change this',result:[{word:'change',start:.2,end:.5,conf:.7}]}},[{atMs:1100,passage:'old'},{atMs:1500,passage:'later'}]);a.equal(T.text(n),'change this');a.equal(n.recognition.partial,'');a.equal(n.text,'My correction');a.equal(n.recognition.segments[0].match.anchor.passage,'old');});

t('silence produces no instruction and wrong recording is rejected',()=>{let n={audio:'note-1.wav'};T.receive(n,{audio:n.audio,final:true,result:{text:''},originMs:0},[]);a.equal(T.text(n),'');a.throws(()=>T.receive(n,{audio:'note-2.wav',final:true,result:{text:'wrong'}},[]));});



t('completion is note-bound and incomplete retains provisional evidence',()=>{let n={audio:'a.wav',text:'user edit'};T.receive(n,{audio:n.audio,final:false,result:{partial:'unfinished'}},[]);T.terminal(n,{audio:n.audio,complete:false,reason:'overflow'});a.equal(n.recognition.complete,false);a.equal(n.recognition.partial,'unfinished');a.equal(n.text,'user edit');a.match(n.status,/incomplete/);a.throws(()=>T.terminal(n,{audio:'other.wav',complete:true,reason:''}));});

t('empty successful transcript finishes without inventing instructions',()=>{let n={audio:'a.wav'};T.terminal(n,{audio:n.audio,complete:true,reason:''});a.equal(n.recognition.complete,true);a.equal(T.text(n),'');});

