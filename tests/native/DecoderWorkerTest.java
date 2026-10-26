package local.audiowriter;



import java.util.concurrent.CountDownLatch;

import java.util.concurrent.TimeUnit;

import java.util.concurrent.atomic.AtomicInteger;



/** Run with plain javac/java. No Android or model required. */

public final class DecoderWorkerTest {

 static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}

 static void waitFor(CountDownLatch latch)throws Exception{check(latch.await(3,TimeUnit.SECONDS),"worker timeout");}

 static class Fake implements DecoderWorker.Decoder {

  int accepts,finishes,closes;

  public void accept(short[] pcm,int count,long sample,double at){accepts++;}

  public void finish(){finishes++;}

  public void close(){closes++;}

 }

 public static void main(String[] args)throws Exception{

  for(int stage=0;stage<3;stage++){

   final int failAt=stage;AtomicInteger errors=new AtomicInteger();

   Fake fake=new Fake(){

    public void prepare(){if(failAt==0)throw new UnsatisfiedLinkError("test");}

    public void accept(short[] p,int n,long s,double t){super.accept(p,n,s,t);if(failAt==1)throw new IllegalStateException("test");}

    public void finish(){super.finish();if(failAt==2)throw new IllegalStateException("test");}

   };

   DecoderWorker worker=new DecoderWorker(fake,m->errors.incrementAndGet(),2);

   worker.offer(new short[]{1},1,0,100);worker.start();worker.end();

   check(worker.await(3000),"failure exits");check(errors.get()==1,"one failure status");check(fake.closes==1,"close once");

   worker.offer(new short[]{2},1,1,101); // failed decoder cannot throw into producer

  }

  CountDownLatch preparing=new CountDownLatch(1),release=new CountDownLatch(1);AtomicInteger errors=new AtomicInteger();

  Fake blocked=new Fake(){public void prepare(){preparing.countDown();try{release.await();}catch(InterruptedException e){throw new RuntimeException(e);}}};

  DecoderWorker overloaded=new DecoderWorker(blocked,m->errors.incrementAndGet(),1);

  overloaded.start();waitFor(preparing);

  Thread producer=new Thread(()->{for(int i=0;i<100;i++)overloaded.offer(new short[]{1},1,i,i);});

  producer.start();producer.join(1000);check(!producer.isAlive(),"producer must not wait for decoder");

  check(errors.get()==1,"overflow reported once");release.countDown();overloaded.end();check(overloaded.await(3000),"overflow exits");

  check(blocked.accepts==0&&blocked.finishes==0,"overflow must not fabricate complete transcript");

  Fake copied=new Fake(){public void accept(short[] p,int n,long s,double t){check(n==2&&p[0]==7&&p[1]==8,"immutable copied frame");check(s==320&&t==1234.5,"original sample and timestamp retained");super.accept(p,n,s,t);}};

  DecoderWorker ordered=new DecoderWorker(copied,m->{throw new AssertionError(m);},2);

  short[] pcm={7,8};ordered.offer(pcm,2,320,1234.5);pcm[0]=99;ordered.start();ordered.end();

  check(ordered.await(3000),"drain exits");check(copied.accepts==1&&copied.finishes==1&&copied.closes==1,"drain then finish then close");

  for(int iteration=0;iteration<100;iteration++){

   Fake tail=new Fake();AtomicInteger completed=new AtomicInteger(),failed=new AtomicInteger();

   DecoderWorker w=new DecoderWorker(tail,new DecoderWorker.Status(){public void failed(String m){failed.incrementAndGet();}public void done(){completed.incrementAndGet();}},32);

   w.start();for(int i=0;i<20;i++)w.offer(new short[]{1},1,i,i);w.end();

   check(w.await(3000),"tail exits");check(tail.accepts==20&&completed.get()==1&&failed.get()==0,"all final frames before completion");

  }

  AtomicInteger completion=new AtomicInteger(),failure=new AtomicInteger();

  Fake cleanup=new Fake(){public void close(){throw new IllegalStateException("cleanup");}};

  DecoderWorker clean=new DecoderWorker(cleanup,new DecoderWorker.Status(){public void failed(String m){failure.incrementAndGet();}public void done(){completion.incrementAndGet();}},1);

  clean.start();clean.end();check(clean.await(3000),"cleanup exits");check(completion.get()==1&&failure.get()==0,"cleanup cannot invalidate completed transcript");

  System.out.println("DecoderWorker: prepare/accept/finish isolation, bounded nonblocking overflow, copied PCM and timestamp, drain/close passed");

 }

}

