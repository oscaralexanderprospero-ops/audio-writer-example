package local.audiowriter;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Claude, 24 Oct 2026: the Control Room link. Its own revocable key from a one-time code, kept only in this
 * app's private files. Only the /companion/v1 calls, only to Author' laptop over Tailscale (see
 * res/xml/network_security_config.xml). It can list and read the writings he picked and send notes back;
 * it cannot approve, publish or change his text. Call from a background thread. */
final class OmsLink {
 static final String HOST="example.invalid";
 static final String BASE="http://"+HOST;
 static final int MAX_BODY=8*1024*1024;
 static final class Result {final int status;final String body;Result(int s,String b){status=s;body=b;}}
 private final AtomicFile file;
 OmsLink(Context c){file=new AtomicFile(new File(c.getFilesDir(),"oms-link.json"));}
 synchronized boolean linked(){return key()!=null;}
 private synchronized String key(){try{String k=new JSONObject(new String(file.readFully(),StandardCharsets.UTF_8)).optString("key","");return k.isEmpty()?null:k;}catch(Exception e){return null;}}
 synchronized void pair(String code)throws IOException{
  Result r=send("POST","/companion/v1/pair","{\"code\":"+JSONObject.quote(code)+"}",null);
  String key;try{key=new JSONObject(r.body).optString("key","");}catch(Exception e){key="";}
  if(r.status!=200||key.isEmpty())throw new IOException(r.status==403?"the link code is used up or too old; make a new one":"Control Room unreachable ("+r.status+")");
  FileOutputStream out=null;try{out=file.startWrite();out.write(new JSONObject().put("key",key).toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(out);}
  catch(Exception e){if(out!=null)file.failWrite(out);throw new IOException("could not save the link");}
 }
 Result request(String method,String path,String body)throws IOException{String k=key();if(k==null)return new Result(401,"{\"error\":\"not linked\"}");return send(method,path,body,k);}
 private static Result send(String method,String path,String body,String key)throws IOException{
  if (true) throw new IOException("Integration disabled in public example");
  HttpURLConnection c=(HttpURLConnection)new URL(BASE+path).openConnection();
  try{c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(60000);c.setRequestMethod(method);c.setUseCaches(false);
   c.setRequestProperty("Accept","application/json");if(key!=null)c.setRequestProperty("X-Audio-Writer-Key",key);
   if(body!=null&&!body.isEmpty()){byte[] b=body.getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");c.setFixedLengthStreamingMode(b.length);try(OutputStream o=c.getOutputStream()){o.write(b);}}
   int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();
   ByteArrayOutputStream all=new ByteArrayOutputStream();if(in!=null)try(InputStream s=in){byte[] buf=new byte[16384];int n;while((n=s.read(buf))!=-1){all.write(buf,0,n);if(all.size()>MAX_BODY)throw new IOException("reply too large");}}
   return new Result(status,all.toString("UTF-8"));
  }finally{c.disconnect();}
 }
}
