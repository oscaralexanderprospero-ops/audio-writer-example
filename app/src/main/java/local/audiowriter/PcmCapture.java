package local.audiowriter;

import android.media.AudioRecord;
import android.media.AudioFormat;
import android.media.AudioTimestamp;
import android.media.MediaRecorder;
import java.io.File;
import java.io.RandomAccessFile;

/** One microphone owner. PCM is persisted before the optional local decoder sees it. */
final class PcmCapture {
 interface Listener { void event(String type, String value); void closed(PcmCapture capture); }
 interface Decoder extends DecoderWorker.Decoder {}
 static final int RATE=16000;
 private final File file; private final Listener listener; private final Decoder decoder;
 private volatile boolean stopping; private volatile AudioRecord input; private Thread worker;
 private final Object micLock=new Object();
 PcmCapture(File file,Listener listener,Decoder decoder){this.file=file;this.listener=listener;this.decoder=decoder;}
 synchronized void start(){if(worker!=null)throw new IllegalStateException("Already started");worker=new Thread(this::run,"AudioWriter-PCM");worker.start();}
 void stop(){stopping=true;synchronized(micLock){AudioRecord r=input;if(r!=null){try{r.stop();}catch(IllegalStateException ignored){}}}} // stop microphone promptly, including a blocked read
 private void run(){boolean good=false;long samples=0;RandomAccessFile out=null;DecoderWorker decoding=null;StringBuilder levels=new StringBuilder();int levelCount=0;
  try {
   if(stopping)return;
   int min=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
   if(min<=0)throw new IllegalStateException("16 kHz PCM unavailable");
   input=new AudioRecord(MediaRecorder.AudioSource.MIC,RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(min,RATE*2*4));
   if(input.getState()!=AudioRecord.STATE_INITIALIZED)throw new IllegalStateException("Microphone unavailable");
   out=new RandomAccessFile(file,"rw");out.setLength(0);header(out,0);
   if(stopping)return;
   input.startRecording();if(input.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IllegalStateException("Microphone did not start");
   listener.event("recording",file.getName());
   if(decoder!=null){decoding=new DecoderWorker(decoder,new DecoderWorker.Status(){public void failed(String message){terminal(false,message);}public void done(){terminal(true,"");}private void terminal(boolean complete,String reason){try{org.json.JSONObject p=new org.json.JSONObject();p.put("audio",file.getName());p.put("complete",complete);p.put("reason",reason);listener.event("transcriptState",p.toString());}catch(org.json.JSONException ignored){}}},3000);decoding.start();}
   short[] pcm=new short[320];byte[] bytes=new byte[640];AudioTimestamp stamp=new AudioTimestamp();
   double origin=System.nanoTime()/1000000.0;long checkpoint=0;
   while(!stopping){
    int n=input.read(pcm,0,pcm.length,AudioRecord.READ_BLOCKING);if(n<0){if(stopping)break;throw new IllegalStateException("PCM read failed: "+n);}if(n==0)continue;
    boolean exact=input.getTimestamp(stamp,AudioTimestamp.TIMEBASE_MONOTONIC)==AudioRecord.SUCCESS;
    double atMs=exact?stamp.nanoTime/1000000.0+(samples-stamp.framePosition)*1000.0/RATE:origin+samples*1000.0/RATE;
    double sum=0;for(int i=0;i<n;i++){bytes[2*i]=(byte)(pcm[i]&255);bytes[2*i+1]=(byte)((pcm[i]>>8)&255);sum+=(double)pcm[i]*pcm[i];}
    out.write(bytes,0,n*2);
    if(levelCount++>0)levels.append(",");levels.append("{\"audio\":\""+file.getName()+"\",\"atMs\":"+atMs+",\"sample\":"+samples+",\"durationMs\":"+(n*1000.0/RATE)+",\"rms\":"+(Math.sqrt(sum/n)/32768.0)+",\"clockQuality\":\""+(exact?"hardware":"estimated")+"\"}");
    if(levelCount==5){listener.event("pcmLevels","["+levels+"]");levels.setLength(0);levelCount=0;}
    long firstSample=samples;samples+=n; // count persisted samples even if decoding fails
    if(decoding!=null)decoding.offer(pcm,n,firstSample,atMs);
    if(samples-checkpoint>=RATE){long end=out.getFilePointer();header(out,samples*2);out.seek(end);out.getFD().sync();checkpoint=samples;}
    if(samples>=RATE*60L*60L){listener.event("captureLimit",file.getName());stopping=true;} // bound WAV/storage to one hour, visibly finalized
   }
   synchronized(micLock){try{input.stop();}catch(IllegalStateException ignored){}}
   good=true;
  } catch(Exception | LinkageError e){listener.event("recordError","PCM recording failed: "+e.getClass().getSimpleName()+"; review any retained partial transcript");}
  finally {
   synchronized(micLock){if(input!=null){try{input.stop();}catch(Exception ignored){}input.release();input=null;}}
   if(levelCount>0)listener.event("pcmLevels","["+levels+"]");
   if(decoding==null){try{org.json.JSONObject p=new org.json.JSONObject();p.put("audio",file.getName());p.put("complete",false);p.put("reason","Capture ended before recognition started");listener.event("transcriptState",p.toString());}catch(org.json.JSONException ignored){}}
   if(decoding!=null)decoding.end(); // decoder drains independently; never delays microphone shutdown or WAV finalization
   if(out!=null){try{header(out,samples*2);out.getFD().sync();out.close();}catch(Exception e){good=false;listener.event("recordError","Audio finalization failed");}}
   listener.closed(this);if(good)listener.event("recorded",file.getName());else listener.event("captureClosed",file.getName());
  }
 }
 private static void le(RandomAccessFile f,long x,int n)throws java.io.IOException{for(int i=0;i<n;i++)f.write((int)(x>>(i*8))&255);}
 static void header(RandomAccessFile f,long size)throws java.io.IOException{f.seek(0);f.writeBytes("RIFF");le(f,size+36,4);f.writeBytes("WAVEfmt ");le(f,16,4);le(f,1,2);le(f,1,2);le(f,RATE,4);le(f,RATE*2,4);le(f,2,2);le(f,16,2);f.writeBytes("data");le(f,size,4);}
}
