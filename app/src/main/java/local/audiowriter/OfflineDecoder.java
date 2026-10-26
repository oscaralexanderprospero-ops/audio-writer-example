package local.audiowriter;
import android.content.Context;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.json.JSONObject;
import java.io.*;

/** Local Vosk decoder. No network or second microphone. Called only on decoder worker. */
final class OfflineDecoder implements PcmCapture.Decoder {
 private final Context context;private final String audio;private final PcmCapture.Listener listener;
 private static Model sharedModel; private static final Object MODEL_LOCK=new Object(); private long lastPartial;private Recognizer recognizer;private double origin=Double.NaN;private String partial="";
 OfflineDecoder(Context c,String audio,PcmCapture.Listener l){context=c.getApplicationContext();this.audio=audio;listener=l;}
 static void warmup(Context context){new Thread(()->{try{new OfflineDecoder(context,"",null).getModel();}catch(Exception|LinkageError ignored){}},"AudioWriter-Model").start();}
 private Model getModel()throws IOException{synchronized(MODEL_LOCK){
  if(sharedModel!=null)return sharedModel;
  File dir=new File(context.getFilesDir(),"vosk-en-us-0.15"),marker=new File(dir,"complete-v2");
  if(!verified(dir,marker)){StringBuilder list=new StringBuilder();copy("speech-model",dir,"",list);File part=new File(dir,"complete-v2.part");
   try(FileOutputStream out=new FileOutputStream(part)){out.write(list.toString().getBytes("UTF-8"));out.getFD().sync();}if(marker.exists()&&!marker.delete())throw new IOException("Cannot replace model marker");if(!part.renameTo(marker))throw new IOException("Model marker incomplete");}
  try{sharedModel=new Model(dir.getAbsolutePath());return sharedModel;}catch(IOException|RuntimeException|LinkageError e){if(marker.exists()&&!marker.delete())throw new IOException("Model failed and recovery marker could not be cleared",e);throw e;}
 }}
 /** Claude, 24 Oct: the marker lists each copied file with its size; a missing or shortened file forces a full re-copy. */
 private static boolean verified(File dir,File marker){if(!marker.isFile())return false;int files=0;
  try(BufferedReader in=new BufferedReader(new InputStreamReader(new FileInputStream(marker),"UTF-8"))){String line;while((line=in.readLine())!=null){int tab=line.lastIndexOf('\t');if(tab<1)return false;File f=new File(dir,line.substring(0,tab));if(!f.isFile()||f.length()!=Long.parseLong(line.substring(tab+1)))return false;files++;}}
  catch(IOException|RuntimeException e){return false;}return files>0;}
 private void status(String message){try{JSONObject p=new JSONObject();p.put("audio",audio);p.put("message",message);listener.event("recognizerStatus",p.toString());}catch(Exception ignored){}}
 public void prepare(){try{status("Loading offline English model; audio capture continues");recognizer=new Recognizer(getModel(),16000);recognizer.setWords(true);recognizer.setPartialWords(false);status("Offline English recognition ready");}catch(Exception e){close();throw new IllegalStateException("Offline model unavailable",e);}}
 private void copy(String asset,File target,String rel,StringBuilder list)throws IOException{String[] children=context.getAssets().list(asset);if(children.length>0){if(!target.exists()&&!target.mkdirs())throw new IOException("Cannot create model folder");for(String child:children)copy(asset+"/"+child,new File(target,child),rel.isEmpty()?child:rel+"/"+child,list);}else{File part=new File(target.getPath()+".part");try(InputStream in=context.getAssets().open(asset);FileOutputStream out=new FileOutputStream(part)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)out.write(b,0,n);out.getFD().sync();}if(target.exists()&&!target.delete())throw new IOException("Cannot replace incomplete model file");if(!part.renameTo(target))throw new IOException("Model copy incomplete");list.append(rel).append('\t').append(target.length()).append('\n');}}
 public void accept(short[] pcm,int count,long firstSample,double atMs){if(Double.isNaN(origin))origin=atMs-firstSample/16.0;boolean done=recognizer.acceptWaveForm(pcm,count);String result=done?recognizer.getResult():recognizer.getPartialResult();long now=System.nanoTime();if(done||(!result.equals(partial)&&now-lastPartial>=200000000L)){emit(result,done);partial=result;lastPartial=now;}}
 private void emit(String result,boolean done){try{JSONObject data=new JSONObject();data.put("audio",audio);data.put("final",done);data.put("originMs",Double.isNaN(origin)?JSONObject.NULL:origin);data.put("timingQuality","estimated-recognizer-word-time");data.put("result",new JSONObject(result));listener.event("transcript",data.toString());}catch(Exception e){throw new IllegalStateException("Invalid recognition result",e);}}
 public void finish(){if(recognizer!=null)emit(recognizer.getFinalResult(),true);}
 public void close(){if(recognizer!=null){recognizer.close();recognizer=null;}}
}
