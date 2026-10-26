package local.audiowriter;

import android.content.*;
import android.media.*;
import android.media.session.*;
import android.os.*;

/** Uses OS-selected routes. No Bluetooth pairing, SCO forcing or permission expansion. */
final class AudioSession {
 interface Controls {void play();void pause();void stop();void interrupted(String reason);void ducked(String reason);}
 static final AudioAttributes SPEECH=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
 private final Context context;private final AudioManager manager;private final MediaSession media;
 private final AudioFocusRequest focus;private boolean held,closed;
 private final BroadcastReceiver noisy;
 private final AudioDeviceCallback devices;
 AudioSession(Context context,Handler main,Controls controls){
  this.context=context;manager=context.getSystemService(AudioManager.class);
  focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(SPEECH).setWillPauseWhenDucked(true).setAcceptsDelayedFocusGain(false)
   .setOnAudioFocusChangeListener(change->{if(change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK){held=false;controls.ducked("Another app played a sound. Narration paused; microphone unchanged. Press Read to resume.");}
    else if(change==AudioManager.AUDIOFOCUS_LOSS||change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT){held=false;controls.interrupted("Audio interrupted by another app or call. Resume explicitly when ready.");}},main).build();
  media=new MediaSession(context,"AudioWriter");
  media.setCallback(new MediaSession.Callback(){public void onPlay(){controls.play();}public void onPause(){controls.pause();}public void onStop(){controls.stop();}},main);
  // No media-button receiver: a terminated session cannot restart microphone or playback.
  media.setMediaButtonReceiver(null);
  noisy=new BroadcastReceiver(){public void onReceive(Context c,Intent i){if(AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction()))controls.interrupted("Headphones disconnected or output changed. Audio stopped; reconnect and resume explicitly.");}};
  IntentFilter filter=new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
  if(Build.VERSION.SDK_INT>=33)context.registerReceiver(noisy,filter,Context.RECEIVER_NOT_EXPORTED);else context.registerReceiver(noisy,filter);
  devices=new AudioDeviceCallback(){public void onAudioDevicesRemoved(AudioDeviceInfo[] removed){for(AudioDeviceInfo d:removed)if(d.isSink()&&privateOutput(d)){controls.interrupted("Headphone output removed. Narration paused and microphone stopped.");break;}}};
  manager.registerAudioDeviceCallback(devices,main);
 }
 private static boolean privateOutput(AudioDeviceInfo d){switch(d.getType()){
  case AudioDeviceInfo.TYPE_WIRED_HEADSET:case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
  case AudioDeviceInfo.TYPE_USB_HEADSET:case AudioDeviceInfo.TYPE_BLE_HEADSET:case AudioDeviceInfo.TYPE_HEARING_AID:return true;default:return false;
 }}
 boolean headphonesAvailable(){for(AudioDeviceInfo d:manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS))if(privateOutput(d))return true;return false;}
 boolean acquire(){if(closed)return false;if(held)return true;held=manager.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED;return held;}
 void abandon(){manager.abandonAudioFocusRequest(focus);held=false;}
 void state(boolean playing,boolean sessionActive){
  media.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_PLAY_PAUSE|PlaybackState.ACTION_STOP)
   .setState(playing?PlaybackState.STATE_PLAYING:PlaybackState.STATE_PAUSED,PlaybackState.PLAYBACK_POSITION_UNKNOWN,playing?1:0).build());
  media.setActive(sessionActive);
 }
 void close(){if(closed)return;closed=true;abandon();manager.unregisterAudioDeviceCallback(devices);context.unregisterReceiver(noisy);media.release();}
}
