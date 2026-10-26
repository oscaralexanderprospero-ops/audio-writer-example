package local.audiowriter;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.speech.tts.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Bound while the screen is open; foreground only after an explicit audio command.
 * Never restarts recording after process death. Journal recovery is independent of Activity life. */
public class ListeningService extends Service {
 interface Sink { void event(String type,String value); void durable(EventJournal.Entry entry); void durableBatch(List<EventJournal.Entry> entries); }
 final class LocalBinder extends Binder { ListeningService service(){return ListeningService.this;} }
 private final Handler main=new Handler(Looper.getMainLooper());
 private final LocalBinder binder=new LocalBinder();
 private volatile EventJournal journal; private Sink sink; private volatile boolean journalFaultReported; private boolean replayed,foreground,ready,playing; // sink, replayed: WRITER thread only
 private volatile PcmCapture recorder;
 private final Set<String> draining=new HashSet<>();
 private AudioSession audioSession; private android.media.MediaPlayer notePlayer;
 private TextToSpeech tts; private PowerManager.WakeLock wake;
 private JSONArray passages; private int sentence,offset,base; private long generation; private String utterance="";
 
 private static final int NOTIFICATION=41;
 private float rate=READING_RATE; private long micHoldUntil; // Claude, 25 Oct: his speed choice; keep the microphone type while a note restarts
 static final float READING_RATE=1.305f; // Author: 24 Oct "speed ... up by 45%" (1.45), then 25 Oct "Slow the text being read by 10%" (1.45 x 0.9)
 // Claude, 24 Oct: one journal, recovered once, and one ordered writer per process. Every event (durable or live) is delivered
 // from WRITER in call order, so the page never sees seq N+1 before N, and no producer (main, PCM, decoder) waits on fsync.
 private static final Object JOURNAL_LOCK=new Object(); private static EventJournal processJournal; private static boolean recovered;
 private static final ThreadPoolExecutor WRITER=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new LinkedBlockingQueue<>(),r->new Thread(r,"AudioWriter-Journal"));
 static{WRITER.allowCoreThreadTimeOut(true);}
 private static final int REPLAY_BATCH=200;
 @Override public IBinder onBind(Intent intent){return binder;}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(intent!=null&&"STOP".equals(intent.getAction())){stopNote();pause();mute();}
  return START_NOT_STICKY;
 }
 @Override public void onCreate(){super.onCreate();
  getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("audio-session","Audio Writer session",NotificationManager.IMPORTANCE_LOW));
  wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"AudioWriter:session");wake.setReferenceCounted(false);
  synchronized(JOURNAL_LOCK){if(!recovered){recovered=true;try{EventJournal j=new EventJournal(new File(getFilesDir(),"events.log"));
   Set<String> pending=new HashSet<>(),openCapture=new HashSet<>();for(EventJournal.Entry e:j.since(0)){if(e.type.equals("recording")){pending.add(e.value);openCapture.add(e.value);}if(e.type.equals("recorded")||e.type.equals("captureClosed"))openCapture.remove(e.value);if(e.type.equals("transcriptState"))try{pending.remove(new JSONObject(e.value).getString("audio"));}catch(JSONException ignored){}}
   for(String audio:pending){JSONObject p=new JSONObject();p.put("audio",audio);p.put("complete",false);p.put("reason","Process interrupted; retained audio completeness unverified");j.append("transcriptState",p.toString());}
   for(String audio:openCapture)j.append("captureClosed",audio);
   j.append("timingReset", "New process; narration requires explicit resume");processJournal=j;
  }catch(IOException|JSONException e){processJournal=null;}}journal=processJournal;}
  audioSession=new AudioSession(this,main,new AudioSession.Controls(){public void play(){resumeNarration();}public void pause(){ListeningService.this.pause();}public void stop(){stopNote();ListeningService.this.pause();mute();}public void interrupted(String reason){interruptAudio(reason);}public void ducked(String reason){ListeningService.this.ducked(reason);}});
  OfflineDecoder.warmup(getApplicationContext());
  tts=new TextToSpeech(getApplicationContext(),status->main.post(()->{ready=status==TextToSpeech.SUCCESS;if(ready){tts.setLanguage(Locale.getDefault());tts.setSpeechRate(rate);tts.setAudioAttributes(AudioSession.SPEECH);}event("tts",ready?"ready":"unavailable");}));
  tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
   public void onStart(String id){main.post(()->{if(id.equals(utterance))position("narrating");});}
   public void onRangeStart(String id,int start,int end,int frame){main.post(()->{if(id.equals(utterance)){offset=base+start;range();}});}
   public void onDone(String id){main.post(()->{if(id.startsWith("aside-")){event("asideDone","");return;}if(playing&&id.equals(utterance)){sentence++;offset=0;speakNext();}});}
   public void onError(String id){main.post(()->{if(id.startsWith("aside-")){event("asideDone","");return;}if(id.equals(utterance)){pause();event("error","Narration failed");}});}
  });
 }
 void attach(Sink target,long cursor){WRITER.execute(()->{
  EventJournal j=journal;if(j==null){target.event("recordError","Event journal unavailable; recording disabled");return;}
  try{List<EventJournal.Entry> all=j.since(cursor);for(int i=0;i<all.size();i+=REPLAY_BATCH)target.durableBatch(new ArrayList<>(all.subList(i,Math.min(all.size(),i+REPLAY_BATCH))));}
  catch(IOException e){target.event("recordError","Event recovery failed; recording disabled");return;}
  sink=target;replayed=true;
  main.post(()->{event("sessionState",(recorder!=null?"recording":"idle")+":"+(playing?"playing":"paused"));position(playing?"narrating":"paused");});
 });}
 void detach(Sink target){WRITER.execute(()->{if(sink==target){sink=null;replayed=false;}});}
 private boolean durable(String type,String value){if(type.equals("transcript")){try{return new JSONObject(value).optBoolean("final");}catch(JSONException e){return false;}}return Arrays.asList("recording","recorded","captureClosed","recordError","transcriptState","recognizerStatus","narrationPosition","audioInterrupted").contains(type);}
 private void event(String type,String value){WRITER.execute(()->deliver(type,value));}
 private void notice(String type,String value){WRITER.execute(()->{if(sink!=null&&replayed)sink.event(type,value);});} // shown, never journaled
 private void deliver(String type,String value){ // WRITER thread only
  try{if(durable(type,value)){EventJournal j=journal;if(j==null)throw new IOException();EventJournal.Entry e=j.append(type,value);if(sink!=null&&replayed)sink.durable(e);}else if(sink!=null&&replayed)sink.event(type,value);}
  catch(IOException e){journal=null;synchronized(JOURNAL_LOCK){processJournal=null;}if(journalFaultReported)return;journalFaultReported=true;if(sink!=null&&replayed)sink.event("recordError","Durable event save failed; audio stopped. Recover storage before continuing.");main.post(()->{pause();mute();});}
 }
 private boolean foreground(boolean microphone){
  try{
   PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
   PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,ListeningService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
   Notification n=new Notification.Builder(this,"audio-session").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Audio Writer session")
    .setContentText(microphone?"Microphone recording · tap Stop to end audio":"Narrating or finishing saved transcription")
    .setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"Stop audio",stop).build()).build();
   int type=ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK|(microphone?ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE:0);
   if(!foreground)startService(new Intent(this,ListeningService.class));
   if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,n,type);else startForeground(NOTIFICATION,n);
   foreground=true;if(!wake.isHeld())wake.acquire(65*60*1000L);return true;
  }catch(RuntimeException e){event("recordError","Foreground audio unavailable: "+e.getClass().getSimpleName());return false;}
 }
 private void idle(){if(audioSession!=null){if(recorder==null&&!playing&&notePlayer==null)audioSession.abandon();audioSession.state(playing||notePlayer!=null,recorder!=null||playing||notePlayer!=null);}boolean hold=SystemClock.elapsedRealtime()<micHoldUntil;if(recorder==null&&!playing&&notePlayer==null&&draining.isEmpty()&&!hold){if(foreground){stopForeground(STOP_FOREGROUND_REMOVE);foreground=false;}if(wake.isHeld())wake.release();stopSelf();}else if(foreground)foreground(recorder!=null||hold);}
 // A note that restarts by itself (new note, cut, start over, the one-hour limit) keeps the microphone type of the foreground
 // service for a few seconds, so recording can start again with the screen off (Android only lets a visible app add it).
 void holdMicrophone(int seconds){micHoldUntil=SystemClock.elapsedRealtime()+Math.max(0,Math.min(30,seconds))*1000L;main.postDelayed(this::idle,Math.min(30,seconds)*1000L+500);}
 void setReadingRate(float r){if(!(r>0))return;rate=Math.max(.5f,Math.min(2.5f,r));if(tts!=null)tts.setSpeechRate(rate);}
 // Speak a few words outside the narration (reading back his last note). Narration is paused first; asideDone tells the page.
 void speakAside(String text){if(!ready||text==null||text.trim().isEmpty()){event("asideDone","");return;}if(playing)pause();audioSession.acquire();
  if(tts.speak(text.length()>4000?text.substring(0,4000):text,TextToSpeech.QUEUE_FLUSH,null,"aside-"+System.nanoTime())==TextToSpeech.ERROR)event("asideDone","");}
 void record(){
  if(journal==null){notice("recordError","Event journal unavailable");return;}
  if(recorder!=null||draining.size()>=2){event("recordError","Wait for the previous audio note to finish processing");return;}
  if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED){event("recordError","Microphone permission not granted");return;}
  if(playing&&!audioSession.headphonesAvailable()){event("recordError","Connect headphones before recording alongside narration. The system chooses the audio route.");idle();return;}
  if(!foreground(true))return;
  if(!audioSession.acquire()){event("recordError","Audio focus unavailable; recording did not start");idle();return;}
  stopNote();
  String name="note-"+System.nanoTime()+".wav";draining.add(name);
  PcmCapture.Listener listener=new PcmCapture.Listener(){
   public void event(String type,String value){ListeningService.this.event(type,value);if(type.equals("transcriptState"))main.post(()->{draining.remove(name);idle();});}
   public void closed(PcmCapture capture){main.post(()->{if(recorder==capture)recorder=null;idle();});}
  };
  try{PcmCapture next=new PcmCapture(new File(getFilesDir(),name),listener,new OfflineDecoder(getApplicationContext(),name,listener));recorder=next;next.start();idle();}
  catch(RuntimeException e){recorder=null;draining.remove(name);event("recordError","Capture could not start");idle();}
 }
 // A notification sound asks us to duck: pause narration and saved-note playback, but never stop his recording for it.
 private void ducked(String reason){if(!playing&&notePlayer==null)return;stopNote();pause();event("narrationPaused",reason);}
 private void interruptAudio(String reason){if(recorder==null&&!playing&&notePlayer==null)return;stopNote();pause();mute();event("audioInterrupted",reason);}
 private void resumeNarration(){if(passages==null)return;narrate(passages.toString(),sentence,offset);}
 void playNote(String name){
  if(recorder!=null){event("notePlayback","Finish recording first");return;}
  if(name==null||!name.matches("note-[0-9]+[.](m4a|wav)")){event("notePlayback","Invalid audio reference");return;}
  stopNote();pause();if(!foreground(false))return;
  if(!audioSession.acquire()){event("notePlayback","Audio focus unavailable");idle();return;}
  try{File file=new File(getFilesDir(),name);if(!file.isFile())throw new IOException();notePlayer=new android.media.MediaPlayer();notePlayer.setAudioAttributes(AudioSession.SPEECH);notePlayer.setDataSource(file.getPath());
   notePlayer.setOnPreparedListener(player->{if(player==notePlayer){player.start();event("notePlayback","Playing saved note");idle();}});
   notePlayer.setOnCompletionListener(player->{if(player!=notePlayer)return;stopNote();event("notePlayback","Saved note finished");idle();});
   notePlayer.setOnErrorListener((player,what,extra)->{if(player!=notePlayer)return true;stopNote();event("notePlayback","Saved note playback failed");idle();return true;});notePlayer.prepareAsync();idle();
  }catch(Exception e){stopNote();event("notePlayback","Recording unavailable or incomplete");idle();}
 }
 void stopNote(){if(notePlayer!=null){notePlayer.release();notePlayer=null;}}
 void stopNotePlayback(){stopNote();idle();}
 void mute(){PcmCapture r=recorder;if(r!=null)r.stop();else idle();}
 void narrate(String json,int at,int resume){
  try{JSONArray next=new JSONArray(json);if(next.length()==0||next.length()>50000||at<0||at>=next.length())throw new JSONException("Invalid narration queue");
   for(int i=0;i<next.length();i++){JSONObject p=next.getJSONObject(i);if(p.getString("text").length()>100000||!p.has("anchor"))throw new JSONException("Invalid passage");}
   if(!ready){event("error","TTS not ready; try again");idle();return;}
   if(recorder!=null&&!audioSession.headphonesAvailable()){event("error","Connect headphones before narrating alongside recording. The system chooses the audio route.");return;}
   if(journal==null||!foreground(recorder!=null))return;
   if(!audioSession.acquire()){event("error","Audio focus unavailable; narration did not start");idle();return;}
   stopNote();
   passages=next;sentence=at;offset=Math.max(0,Math.min(resume,next.getJSONObject(at).getString("text").length()));generation++;playing=true;speakNext();idle();
  }catch(JSONException e){event("error","Invalid narration queue");}
 }
 private void speakNext(){try{if(passages==null||sentence>=passages.length()){playing=false;utterance="";event("narrationEnded","");idle();return;}
  String text=passages.getJSONObject(sentence).getString("text");base=offset;utterance=generation+":"+sentence;
  if(tts.speak(text.substring(offset),TextToSpeech.QUEUE_FLUSH,null,utterance)==TextToSpeech.ERROR){pause();event("error","TTS rejected narration");}
 }catch(JSONException e){pause();event("error","Invalid narration passage");}}
 private JSONObject place(String mode)throws JSONException{if(passages==null||sentence>=passages.length())return null;JSONObject p=new JSONObject();JSONObject anchor=new JSONObject(passages.getJSONObject(sentence).getJSONObject("anchor").toString());anchor.put("offset",offset);p.put("anchor",anchor);p.put("index",sentence);p.put("offset",offset);p.put("atMs",System.nanoTime()/1000000.0);p.put("mode",mode);return p;}
 private void position(String mode){if(journal==null)return;try{JSONObject p=place(mode);if(p!=null)event("narrationPosition",p.toString());}catch(JSONException ignored){}}
 private void range(){try{JSONObject p=place("narrating");if(p!=null)event("narrationRange",p.toString());}catch(JSONException ignored){}} // live only: durable once per sentence and on pause, not per word
 void pause(){playing=false;utterance="";if(tts!=null)tts.stop();position("paused");idle();}
 boolean capturing(){return recorder!=null;}
 @Override public void onDestroy(){stopNote();if(audioSession!=null)audioSession.close();if(recorder!=null)recorder.stop();if(tts!=null){tts.stop();tts.shutdown();}if(wake.isHeld())wake.release();super.onDestroy();}
}
