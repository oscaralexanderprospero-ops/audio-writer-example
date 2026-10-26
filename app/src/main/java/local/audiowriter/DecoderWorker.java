package local.audiowriter;



import java.util.Arrays;

import java.util.concurrent.ArrayBlockingQueue;

import java.util.concurrent.TimeUnit;

import java.util.concurrent.atomic.AtomicBoolean;



/** Bounded, nonblocking handoff. Decoder failures never propagate to PCM capture. */

final class DecoderWorker {

 interface Decoder { default void prepare(){} default void close(){} void accept(short[] pcm,int count,long firstSample,double atMs); void finish(); }

 interface Status { void failed(String message); default void done(){} }

 private static final class Frame {

  final short[] pcm; final long sample; final double at;

  Frame(short[] pcm,int count,long sample,double at){this.pcm=Arrays.copyOf(pcm,count);this.sample=sample;this.at=at;}

 }

 private final Decoder decoder; private final Status status;

 private final ArrayBlockingQueue<Frame> queue;

 private final AtomicBoolean failed=new AtomicBoolean();

 private volatile boolean ended;

 private final Thread worker;

 DecoderWorker(Decoder decoder,Status status,int capacity){

  this.decoder=decoder;this.status=status;queue=new ArrayBlockingQueue<>(capacity);

  worker=new Thread(this::run,"AudioWriter-Decoder");

 }

 void start(){worker.start();}

 void offer(short[] pcm,int count,long sample,double at){

  if(ended||failed.get())return;

  if(!queue.offer(new Frame(pcm,count,sample,at)))fail("Recognizer fell behind; transcript incomplete; audio still recording");

 }

 void end(){ended=true;}

 boolean await(long millis)throws InterruptedException{worker.join(millis);return !worker.isAlive();}

 private void fail(String message){if(failed.compareAndSet(false,true)){queue.clear();try{status.failed(message);}catch(RuntimeException ignored){}}}

 private void run(){

  try{

   decoder.prepare();

   while(!failed.get()){

    Frame frame=queue.poll(50,TimeUnit.MILLISECONDS);

    if(frame==null&&ended)frame=queue.poll(); // acquire ended before the final queue check

    if(frame!=null){if(!failed.get())decoder.accept(frame.pcm,frame.pcm.length,frame.sample,frame.at);}

    else if(ended)break;

   }

   if(!failed.get()){decoder.finish();status.done();}

  }catch(Exception|LinkageError e){fail("Offline recognition unavailable; transcript incomplete; audio recording is independent");}

  finally{try{decoder.close();}catch(Exception|LinkageError e){/* Cleanup failure does not invalidate already emitted final text. */}}

 }

}

