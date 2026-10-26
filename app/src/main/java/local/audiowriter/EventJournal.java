package local.audiowriter;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** One process owner; complete records are durable before they may be delivered. */
final class EventJournal {
 static final class Entry {final long seq;final String type,value;Entry(long s,String t,String v){seq=s;type=t;value=v;}}
 private final File file; private long sequence;
 EventJournal(File file)throws IOException{this.file=file;scan(true);}
 private String encode(String s){return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));}
 private List<Entry> scan(boolean recover)throws IOException{
  List<Entry> entries=new ArrayList<>();long good=0,previous=0,end=0;
  if(!file.exists())new RandomAccessFile(file,"rw").close();
  try(InputStream in=new BufferedInputStream(new FileInputStream(file),1<<16)){
   ByteArrayOutputStream bytes=new ByteArrayOutputStream(256);int b;
   while(true){
    b=in.read();if(b!=-1){end++;if(b!='\n'){bytes.write(b);continue;}}
    if(b==-1){if(bytes.size()>0&&recover){try(RandomAccessFile f=new RandomAccessFile(file,"rw")){f.setLength(good);f.getFD().sync();}}break;}
    String line=bytes.toString("US-ASCII");bytes.reset();if(line.endsWith("\r"))line=line.substring(0,line.length()-1);
    try{String[] p=line.split("\\t",-1);long seq=Long.parseLong(p[0]);if(p.length!=3||seq!=previous+1)throw new IllegalArgumentException();
     entries.add(new Entry(seq,new String(Base64.getDecoder().decode(p[1]),StandardCharsets.UTF_8),new String(Base64.getDecoder().decode(p[2]),StandardCharsets.UTF_8)));previous=seq;good=end;
    }catch(RuntimeException e){throw new IOException("Invalid complete journal record; recovery required",e);}
   }
  }sequence=previous;return entries;
 }
 synchronized Entry append(String type,String value)throws IOException{
  Entry e=new Entry(sequence+1,type,value);byte[] bytes=(e.seq+"\t"+encode(type)+"\t"+encode(value)+"\n").getBytes(StandardCharsets.US_ASCII);
  try(RandomAccessFile f=new RandomAccessFile(file,"rw")){long start=f.length();f.seek(start);try{f.write(bytes);f.getFD().sync();}catch(IOException x){f.setLength(start);throw x;}}
  sequence=e.seq;return e;
 }
 synchronized List<Entry> since(long seq)throws IOException{List<Entry> result=scan(false);if(seq<0||seq>sequence)throw new IOException("Journal cursor out of range");result.removeIf(e->e.seq<=seq);return result;}
}
