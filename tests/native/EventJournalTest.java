package local.audiowriter;
import java.io.*;
import java.nio.file.Files;
public class EventJournalTest {
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  File f=Files.createTempFile("audio-journal-test",".log").toFile();
  try{
   EventJournal j=new EventJournal(f);j.append("recording","a.wav");j.append("final","line\nnext\tunicode: \u03bb");
   check(j.since(0).size()==2);check(j.since(1).get(0).value.equals("line\nnext\tunicode: \u03bb"));check(j.since(2).isEmpty());
   try(FileOutputStream out=new FileOutputStream(f,true)){out.write("3\tincomplete".getBytes("UTF-8"));}
   EventJournal recovered=new EventJournal(f);check(recovered.since(0).size()==2);check(recovered.append("done","ok").seq==3);
   try(FileOutputStream out=new FileOutputStream(f,true)){out.write("invalid complete line\n".getBytes("UTF-8"));}
   boolean rejected=false;try{new EventJournal(f);}catch(IOException e){rejected=true;}check(rejected);
   File big=Files.createTempFile("audio-journal-big",".log").toFile(); // Claude: buffered scan over a long journal
   try{StringBuilder s=new StringBuilder();java.util.Base64.Encoder b64=java.util.Base64.getEncoder();
    for(int i=1;i<=20000;i++)s.append(i).append('\t').append(b64.encodeToString("narrationPosition".getBytes("UTF-8"))).append('\t').append(b64.encodeToString(("{\"index\":"+i+"}").getBytes("UTF-8"))).append('\n');
    try(FileOutputStream out=new FileOutputStream(big)){out.write(s.toString().getBytes("US-ASCII"));out.write("20001\tcut".getBytes("US-ASCII"));}
    long t0=System.nanoTime();EventJournal long1=new EventJournal(big);check(long1.since(19990).size()==10);check(long1.since(0).get(19999).value.equals("{\"index\":20000}"));
    check(long1.append("done","ok").seq==20001);check(new EventJournal(big).since(20000).get(0).type.equals("done"));
    System.out.println("EventJournal 20000-record scan, tail cut and append: "+(System.nanoTime()-t0)/1000000+" ms on this desktop");
   }finally{big.delete();}
   System.out.println("EventJournal append/replay, unicode, cut-tail recovery, complete corruption rejection passed");
  }finally{f.delete();}
 }
}
