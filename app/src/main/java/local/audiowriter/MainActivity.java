package local.audiowriter;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.speech.tts.*;

import android.media.MediaPlayer;
import android.content.pm.PackageManager;
import android.Manifest;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.util.Locale;

public class MainActivity extends Activity {

 WebView web; boolean active=false,bound=false,pageReady=false; ListeningService session;
 final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
 final ListeningService.Sink sink=new ListeningService.Sink(){
  public void event(String type,String value){MainActivity.this.event(type,value);}
  public void durable(EventJournal.Entry e){main.post(()->{if(!isDestroyed()&&pageReady)web.evaluateJavascript("journalEvent("+e.seq+","+JSONObject.quote(e.type)+","+JSONObject.quote(e.value)+")",null);});}
  public void durableBatch(java.util.List<EventJournal.Entry> entries){org.json.JSONArray all=new org.json.JSONArray();for(EventJournal.Entry e:entries)all.put(new org.json.JSONArray().put(e.seq).put(e.type).put(e.value));String js="journalBatch("+all+")";main.post(()->{if(!isDestroyed()&&pageReady)web.evaluateJavascript(js,null);});}
 };
 final android.content.ServiceConnection connection=new android.content.ServiceConnection(){
  public void onServiceConnected(android.content.ComponentName name,android.os.IBinder binder){session=((ListeningService.LocalBinder)binder).service();bound=true;if(pageReady)web.evaluateJavascript("replayNativeJournal()",null);}
  public void onServiceDisconnected(android.content.ComponentName name){session=null;event("suspended","Audio service disconnected; retained data will be recovered when reopened");}
 };
 void event(String type,String value){main.post(()->{if(!isDestroyed()&&pageReady)web.evaluateJavascript("nativeEvent("+JSONObject.quote(type)+","+JSONObject.quote(value)+")",null);});}
 @Override public void onCreate(Bundle b){super.onCreate(b);web=new WebView(this);setContentView(web);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(true);web.getSettings().setAllowContentAccess(false);web.addJavascriptInterface(new Bridge(),"Native");web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}});web.loadUrl("file:///android_asset/index.html");bound=bindService(new android.content.Intent(this,ListeningService.class),connection,BIND_AUTO_CREATE);link=new OmsLink(this);handleLink(getIntent());}
 // Control Room link (Claude, 24 Oct 2026): the Link button on his phone app page opens audiowriter://pair?c=CODE.
 OmsLink link; final java.util.concurrent.ExecutorService net=java.util.concurrent.Executors.newSingleThreadExecutor();
 @Override protected void onNewIntent(android.content.Intent i){super.onNewIntent(i);setIntent(i);handleLink(i);}
 // Open in Audio Writer (Control Room, 25 Oct 2026): audiowriter://open?w=<writing id>; the page takes it when ready.
 volatile String pendingOpen;
 void handleLink(android.content.Intent i){android.net.Uri u=i==null?null:i.getData();if(u==null||!"audiowriter".equals(u.getScheme()))return;
  if("open".equals(u.getHost())){String w=u.getQueryParameter("w");i.setData(null);if(w!=null&&w.matches("[A-Za-z0-9_.:-]{1,160}")){pendingOpen=w;event("omsOpen",w);}return;}
  if(!"pair".equals(u.getHost()))return;String code=u.getQueryParameter("c");i.setData(null);
  if(code==null||code.isEmpty()||code.length()>100){event("omsLink","error:the link code is missing");return;}
  net.execute(()->{try{link.pair(code);event("omsLink","linked");}catch(IOException e){event("omsLink","error:"+e.getMessage());}});}
 void beginSession(){startService(new android.content.Intent(this,ListeningService.class));}
 class Bridge {
  @JavascriptInterface public boolean omsLinked(){return link!=null&&link.linked();}
  // Deleting and cutting notes (Author, 25 Oct 2026). Delete moves the recording to files/deleted/ (Restore brings it back;
  // Delete for good removes it). A cut moves the removed end of a finished recording there too, so Undo cut can put it back.
  @JavascriptInterface public boolean deleteNoteAudio(String name){main.post(()->{if(session!=null)session.stopNotePlayback();});return moveAudio(name,getFilesDir(),trash());}
  @JavascriptInterface public boolean restoreNoteAudio(String name){return moveAudio(name,trash(),getFilesDir());}
  @JavascriptInterface public boolean purgeNoteAudio(String name){if(!noteFile(name))return false;File f=new File(trash(),name);boolean ok=!f.exists()||f.delete();
   File[] cuts=trash().listFiles((d,n)->n.startsWith(name+".cut-"));if(cuts!=null)for(File c:cuts)ok&=c.delete();return ok;}
  @JavascriptInterface public String trimNoteAudio(String name,double cutSeconds){
   if(!noteFile(name)||!name.endsWith(".wav")||!(cutSeconds>0)||cutSeconds>36000)return "";File f=new File(getFilesDir(),name);if(!f.isFile())return "";
   try(RandomAccessFile r=new RandomAccessFile(f,"rw")){long data=r.length()-44;if(data<0)return "";data-=data%2;
    long cut=Math.min(data,Math.round(cutSeconds*PcmCapture.RATE)*2),keep=data-cut;File dir=trash();if(!dir.isDirectory()&&!dir.mkdirs())return "";
    File tail=new File(dir,name+".cut-"+System.currentTimeMillis()+".pcm");
    try(FileOutputStream out=new FileOutputStream(tail)){r.seek(44+keep);byte[] b=new byte[65536];long left=cut;int n;while(left>0&&(n=r.read(b,0,(int)Math.min(b.length,left)))>0){out.write(b,0,n);left-=n;}out.getFD().sync();}
    r.setLength(44+keep);PcmCapture.header(r,keep);r.getFD().sync();
    return new JSONObject().put("total",data/(2.0*PcmCapture.RATE)).put("kept",keep/(2.0*PcmCapture.RATE)).put("tail",tail.getName()).toString();
   }catch(Exception e){return "";}}
  @JavascriptInterface public boolean untrimNoteAudio(String name,String tailName){
   if(!noteFile(name)||tailName==null||!tailName.matches(java.util.regex.Pattern.quote(name)+"[.]cut-[0-9]+[.]pcm"))return false;File f=new File(getFilesDir(),name),tail=new File(trash(),tailName);if(!f.isFile()||!tail.isFile())return false;
   try(RandomAccessFile r=new RandomAccessFile(f,"rw");FileInputStream in=new FileInputStream(tail)){long data=r.length()-44;r.seek(44+data);byte[] b=new byte[65536];int n;while((n=in.read(b))>0)r.write(b,0,n);
    PcmCapture.header(r,data+tail.length());r.getFD().sync();}catch(Exception e){return false;}return tail.delete();}
  @JavascriptInterface public String takeOpen(){String w=pendingOpen;pendingOpen=null;return w==null?"":w;}
  @JavascriptInterface public void oms(String id,String method,String path,String body){
   if(id==null||!id.matches("q[0-9]{1,9}"))return;
   if(!("GET".equals(method)||"POST".equals(method))||path==null||!path.matches("/companion/v1/(writings(/[A-Za-z0-9_.:-]{1,160})?|edit-requests)")||(body!=null&&body.length()>OmsLink.MAX_BODY)){omsDone(id,0,"{\"error\":\"request refused on the phone\"}");return;}
   net.execute(()->{try{OmsLink.Result r=link.request(method,path,body);omsDone(id,r.status,r.body);}catch(Exception e){omsDone(id,0,"");}});}
  @JavascriptInterface public void replay(long since){main.post(()->{pageReady=true;if(session==null)return;session.attach(sink,since);});}
  @JavascriptInterface public String load(){try{AtomicFile f=new AtomicFile(new File(getFilesDir(),"session.json"));return new String(f.readFully(),"UTF-8");}catch(Exception e){File f=new File(getFilesDir(),"session.json");return f.exists()||new File(f.getPath()+".bak").exists()?"STORAGE_READ_FAILED":"";}}
  @JavascriptInterface public boolean save(String value){AtomicFile f=new AtomicFile(new File(getFilesDir(),"session.json"));FileOutputStream out=null;try{out=f.startWrite();out.write(value.getBytes("UTF-8"));f.finishWrite(out);return true;}catch(Exception e){if(out!=null)f.failWrite(out);return false;}}
  @JavascriptInterface public void narrate(String queue,int index,int offset){main.post(()->{if(!active||session==null){event("error","Audio service not ready; try again");return;}beginSession();session.narrate(queue,index,offset);});}
  @JavascriptInterface public void stop(){main.post(()->{if(session!=null)session.pause();});}
  @JavascriptInterface public void record(){main.post(()->{if(!active||session==null){event("recordError","Open the app and wait for audio service readiness");return;}if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},7);event("recordError","Microphone permission requested. After granting, press Record again.");return;}beginSession();session.record();});}
  @JavascriptInterface public double clockMillis(){return System.nanoTime()/1000000.0;}

  @JavascriptInterface public void playNote(String name){main.post(()->{if(!active||session==null){event("notePlayback","Open the app and wait for audio readiness");return;}beginSession();session.playNote(name);});}
  @JavascriptInterface public void stopNotePlayback(){main.post(()->{if(session!=null)session.stopNotePlayback();});}
  @JavascriptInterface public void mute(){main.post(()->{if(session!=null)session.mute();});}
  // Claude, 25 Oct 2026: reading speed, read-back, microphone hold, and short tones when a spoken command is heard.
  @JavascriptInterface public void setReadingRate(float r){main.post(()->{if(session!=null)session.setReadingRate(r);});}
  @JavascriptInterface public void speakAside(String text){main.post(()->{if(session!=null)session.speakAside(text);});}
  @JavascriptInterface public void keepMicrophone(int seconds){main.post(()->{if(session!=null)session.holdMicrophone(seconds);});}
  @JavascriptInterface public void tone(String kind){main.post(()->{try{android.media.ToneGenerator g=new android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC,60);
   g.startTone("big".equals(kind)?android.media.ToneGenerator.TONE_PROP_BEEP2:"no".equals(kind)?android.media.ToneGenerator.TONE_PROP_NACK:android.media.ToneGenerator.TONE_PROP_ACK,180);main.postDelayed(g::release,600);}catch(RuntimeException ignored){}});}
 }

 File trash(){return new File(getFilesDir(),"deleted");}
 static boolean noteFile(String n){return n!=null&&n.matches("note-[0-9]+[.](m4a|wav)");}
 boolean moveAudio(String name,File from,File to){if(!noteFile(name))return false;File src=new File(from,name);if(!src.exists())return true;if(!to.isDirectory()&&!to.mkdirs())return false;File dst=new File(to,name);return (!dst.exists()||dst.delete())&&src.renameTo(dst);}
 void omsDone(String id,int status,String body){try{event("omsResult",new JSONObject().put("id",id).put("status",status).put("body",body==null?"":body).toString());}catch(org.json.JSONException ignored){}}
 @Override protected void onResume(){super.onResume();active=true;}
 @Override protected void onPause(){active=false;super.onPause();}
 @Override protected void onDestroy(){if(session!=null)session.detach(sink);if(bound)unbindService(connection);web.removeJavascriptInterface("Native");web.destroy();super.onDestroy();}
}
