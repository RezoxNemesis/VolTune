package com.rezox.hdmiconnect;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.*;
import android.hardware.display.DisplayManager;
import android.hardware.usb.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import android.text.InputType;
import java.util.*;

public class MainActivity extends Activity {
    private static final int BG=0xff081223, CARD=0xff142238, MUTED=0xffb0bed3, WHITE=0xfff1f6ff, BLUE=0xff397de6, YELLOW=0xffffc072, GREEN=0xff64e0b0, RED=0xffff7c90;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ArrayList<Display> displays=new ArrayList<>();
    private boolean receiverRegistered=false, externalOutput=true, playing=true, demo=true, seeking=false;
    private int selectedId=-1, position=0;
    private Uri videoUri, localVideo;
    private String videoName="Offline moving signal test";
    private VideoView phoneVideo;
    private TestView phoneTest;
    private View placeholder;
    private TextView status, diagnostics, playingTitle, playingWhere, playButton, outputButton, clock, wifiState;
    private SeekBar seek;
    private ExternalPlayer external;
    private WifiReceiver receiver;
    private final DisplayManager.DisplayListener displayEvents=new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int id) {handler.postDelayed(()->scan(),300);}
        @Override public void onDisplayRemoved(int id) {scan();}
        @Override public void onDisplayChanged(int id) {scan();}
    };
    private final BroadcastReceiver usbEvents=new BroadcastReceiver() {
        @Override public void onReceive(Context context,Intent i){handler.postDelayed(()->scan(),350);}
    };
    private final Runnable ticker=new Runnable() {
        @Override public void run(){updateControls();handler.postDelayed(this,600);}
    };

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);
        makeUi();
        playDemo();
        handler.post(ticker);
    }
    @Override public void onResume(){
        super.onResume();
        getSystemService(DisplayManager.class).registerDisplayListener(displayEvents,handler);
        IntentFilter filter=new IntentFilter();
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(usbEvents,filter,Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(usbEvents,filter);
        receiverRegistered=true;
        scan();
    }
    @Override public void onPause(){
        getSystemService(DisplayManager.class).unregisterDisplayListener(displayEvents);
        if(receiverRegistered){try{unregisterReceiver(usbEvents);}catch(Exception ignored){}receiverRegistered=false;}
        super.onPause();
    }
    @Override public void onDestroy(){
        handler.removeCallbacks(ticker);
        if(receiver!=null)receiver.close();
        closeExternal();
        phoneVideo.stopPlayback();
        phoneTest.animate(false);
        super.onDestroy();
    }

    private int dp(int v){return (int)(getResources().getDisplayMetrics().density*v+0.5f);}
    private GradientDrawable background(int color,int radius){
        GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;
    }
    private TextView text(String value,int sp,int color,boolean strong){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(sp);t.setTextColor(color);
        if(strong)t.setTypeface(android.graphics.Typeface.DEFAULT,android.graphics.Typeface.BOLD);
        t.setGravity(Gravity.CENTER_VERTICAL);t.setLineSpacing(dp(2),1f);return t;
    }
    private LinearLayout vertical(int pad){
        LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(dp(pad),dp(pad),dp(pad),dp(pad));return l;
    }
    private LinearLayout card(LinearLayout parent){
        LinearLayout l=vertical(15);l.setBackground(background(CARD,16));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(12);parent.addView(l,lp);return l;
    }
    private void heading(LinearLayout parent,String title){
        TextView t=text(title.toUpperCase(Locale.ROOT),12,MUTED,true);t.setLetterSpacing(0.08f);t.setPadding(0,dp(17),0,dp(8));parent.addView(t);
    }
    private TextView button(LinearLayout parent,String title,boolean bright,Runnable command){
        TextView t=text(title,15,WHITE,true);t.setGravity(Gravity.CENTER);t.setBackground(background(bright?BLUE:0xff263956,11));
        t.setOnClickListener(v->command.run());
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(48));lp.topMargin=dp(8);parent.addView(t,lp);return t;
    }
    private void makeUi(){
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(BG);
        LinearLayout root=vertical(17);scroll.addView(root);setContentView(scroll);
        TextView title=text("HDMI CONNECT",28,WHITE,true);title.setLetterSpacing(-0.02f);root.addView(title);
        root.addView(text("Fresh Android app · display detection · video cinema",13,MUTED,false));
        heading(root,"Live cable and display status");
        LinearLayout connection=card(root);
        status=text("Checking connections…",19,WHITE,true);connection.addView(status);
        diagnostics=text("",13,MUTED,false);diagnostics.setPadding(0,dp(8),0,dp(7));connection.addView(diagnostics);
        button(connection,"Rescan connected devices",true,()->scan());
        button(connection,"Choose a detected screen",false,()->chooseDisplay());

        heading(root,"Video player");
        LinearLayout player=card(root);
        playingTitle=text("Offline moving signal test",17,WHITE,true);player.addView(playingTitle);
        playingWhere=text("Playing on phone",12,MUTED,false);playingWhere.setPadding(0,dp(5),0,dp(8));player.addView(playingWhere);
        FrameLayout preview=new FrameLayout(this);preview.setBackground(background(0xff020b1e,12));
        phoneVideo=new VideoView(this);phoneTest=new TestView(this);
        TextView note=text("Playing on the external screen.\nUse your phone for playback controls.",15,WHITE,false);
        note.setGravity(Gravity.CENTER);note.setBackgroundColor(0xff0b1d30);note.setVisibility(View.GONE);placeholder=note;
        preview.addView(phoneVideo,new FrameLayout.LayoutParams(-1,-1));
        preview.addView(phoneTest,new FrameLayout.LayoutParams(-1,-1));
        preview.addView(placeholder,new FrameLayout.LayoutParams(-1,-1));
        int height=Math.max(dp(165),(getResources().getDisplayMetrics().widthPixels-dp(64))*9/16);
        player.addView(preview,new LinearLayout.LayoutParams(-1,height));
        LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);row.setPadding(0,dp(10),0,dp(5));
        playButton=text("Pause",15,WHITE,true);playButton.setGravity(Gravity.CENTER);playButton.setBackground(background(0xff263956,10));playButton.setOnClickListener(v->togglePlay());
        LinearLayout.LayoutParams a=new LinearLayout.LayoutParams(0,dp(48),1);a.rightMargin=dp(8);row.addView(playButton,a);
        outputButton=text("Send to display",15,WHITE,true);outputButton.setGravity(Gravity.CENTER);outputButton.setBackground(background(BLUE,10));outputButton.setOnClickListener(v->toggleOutput());
        row.addView(outputButton,new LinearLayout.LayoutParams(0,dp(48),1.7f));player.addView(row);
        seek=new SeekBar(this);player.addView(seek);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
            @Override public void onProgressChanged(SeekBar b,int p,boolean fromUser){}
            @Override public void onStartTrackingTouch(SeekBar b){seeking=true;}
            @Override public void onStopTrackingTouch(SeekBar b){seeking=false;if(!demo&&activeVideo()!=null){activeVideo().seekTo(seek.getProgress());position=seek.getProgress();}}
        });
        clock=text("Motion test",12,MUTED,false);player.addView(clock);

        heading(root,"Videos to play");
        LinearLayout library=card(root);
        library.addView(text("Offline display animation, video samples (internet), and any video in your phone's files.",13,MUTED,false));
        button(library,"▶  Offline color and motion test",true,()->playDemo());
        button(library,"▶  Nature — Flower (short)",false,()->playUri(Uri.parse("https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"),"Nature — Flower"));
        button(library,"▶  Big Buck Bunny",false,()->playUri(Uri.parse("https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"),"Big Buck Bunny"));
        button(library,"▶  Elephant Dream",false,()->playUri(Uri.parse("https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"),"Elephant Dream"));
        button(library,"Choose video from my phone",false,()->chooseVideo());
        button(library,"Play an HTTPS MP4 URL",false,()->askVideoUrl());

        heading(root,"Browser output for HDMI-connected devices");
        LinearLayout network=card(root);
        network.addView(text("For a smart TV, HDMI streaming stick or computer with a browser: share video from this phone over local Wi-Fi. Open the link shown below on the other device. A plain HDMI-only monitor cannot open websites.",13,MUTED,false));
        wifiState=text("Receiver not started",13,MUTED,false);wifiState.setTextIsSelectable(true);wifiState.setPadding(0,dp(7),0,dp(4));network.addView(wifiState);
        button(network,"Start / stop Wi-Fi video receiver",true,()->toggleReceiver());
        button(network,"Copy receiver address",false,()->copyAddress());

        heading(root,"Connection options");
        LinearLayout help=card(root);
        help.addView(text("If the phone does not expose a secondary display, a simple USB-C→HDMI hub cannot be made to output video by software. For a phone without video-out hardware, consider a genuine USB DisplayLink adapter with its driver, or a casting receiver.",13,MUTED,false));
        button(help,"Open Android wireless casting",false,()->openCast());
        button(help,"Open official DisplayLink Presenter",false,()->openDisplayLink());
        root.addView(text("No root, Shizuku, Accessibility or broad storage permissions. This app cannot create an HDMI signal unsupported by the phone's hardware.",12,MUTED,false));
        root.addView(new View(this),new LinearLayout.LayoutParams(1,dp(27)));
    }

    private List<Display> availableDisplays(){
        DisplayManager dm=getSystemService(DisplayManager.class);
        ArrayList<Display> out=new ArrayList<>();
        for(Display d:dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)){
            if(d.isValid() && d.getDisplayId()!=Display.DEFAULT_DISPLAY)out.add(d);
        }
        if(out.isEmpty()){
            for(Display d:dm.getDisplays())if(d.isValid()&&d.getDisplayId()!=Display.DEFAULT_DISPLAY&&(d.getFlags()&Display.FLAG_PRIVATE)==0)out.add(d);
        }
        return out;
    }
    private Display selectedDisplay(){
        for(Display d:displays)if(d.getDisplayId()==selectedId)return d;
        return displays.isEmpty()?null:displays.get(0);
    }
    private void scan(){
        if(isFinishing()||isDestroyed())return;
        displays.clear();displays.addAll(availableDisplays());
        Map<String,UsbDevice> devices=getSystemService(UsbManager.class).getDeviceList();
        boolean displayLink=false,billboard=false;
        StringBuilder info=new StringBuilder();
        for(UsbDevice d:devices.values()){
            if(d.getVendorId()==0x17e9)displayLink=true;
            if(d.getDeviceClass()==0x11)billboard=true;
            for(int i=0;i<d.getInterfaceCount();i++)if(d.getInterface(i).getInterfaceClass()==0x11)billboard=true;
            if(info.length()<170){
                info.append(String.format(Locale.US,"\nUSB %04X:%04X",d.getVendorId(),d.getProductId()));
                if(d.getDeviceClass()==UsbConstants.USB_CLASS_HUB)info.append(" (hub)");
            }
        }
        if(!displays.isEmpty()){
            Display d=selectedDisplay();
            status.setText("An external screen is available");status.setTextColor(GREEN);
            diagnostics.setText(displays.size()+" accessible Android display(s).\n"+d.getName()+" • "+d.getMode().getPhysicalWidth()+"×"+d.getMode().getPhysicalHeight()+" • "+Math.round(d.getRefreshRate())+" Hz\nAndroid does not always reveal whether the screen uses HDMI, Wi-Fi or another transport."+info);
        }else if(displayLink){
            status.setText("DisplayLink adapter found");status.setTextColor(YELLOW);
            diagnostics.setText("USB graphics hardware detected, but no Android display yet. Enable the official DisplayLink Presenter app."+info);
        }else if(billboard){
            status.setText("USB-C video mode was not established");status.setTextColor(RED);
            diagnostics.setText("An adapter reported USB Billboard. This can mean video alternate-mode negotiation failed. No normal app can enable a missing video mode."+info);
        }else if(!devices.isEmpty()){
            status.setText("USB detected — no video screen");status.setTextColor(YELLOW);
            diagnostics.setText(devices.size()+" USB device(s) visible, but Android has no external video display. An HDMI adapter may not appear as a USB device at all. Check OTG, HDMI input and the phone's video-output support."+info);
        }else{
            status.setText("No external screen detected");status.setTextColor(MUTED);
            diagnostics.setText("Plug in compatible video hardware, then rescan. A passive USB-C HDMI adapter cannot work without hardware video output. The offline test and phone player still work.");
        }
        int before=external==null?-1:external.getDisplay().getDisplayId();
        Display desired=externalOutput?selectedDisplay():null;
        int after=desired==null?-1:desired.getDisplayId();
        if(before!=after)route(currentPosition());
        updateOutput();
    }
    private void chooseDisplay(){
        if(displays.isEmpty()){message("No video output","Android has not detected a usable second display. USB data alone is not enough.");return;}
        String[] labels=new String[displays.size()];
        for(int i=0;i<displays.size();i++)labels[i]=displays.get(i).getName()+" (ID "+displays.get(i).getDisplayId()+")";
        new AlertDialog.Builder(this).setTitle("Choose external screen").setItems(labels,(dialog,which)->{
            int pos=currentPosition();selectedId=displays.get(which).getDisplayId();externalOutput=true;route(pos);scan();
        }).setNegativeButton("Cancel",null).show();
    }
    private void playDemo(){
        demo=true;videoUri=null;videoName="Offline moving signal test";playing=true;position=0;playingTitle.setText(videoName);route(0);
    }
    private void playUri(Uri uri,String title){
        demo=false;videoUri=uri;videoName=title;playing=true;position=0;playingTitle.setText(title);route(0);
    }
    private void route(int pos){
        position=Math.max(0,pos);
        Display d=externalOutput?selectedDisplay():null;
        if(d==null){
            closeExternal();placeholder.setVisibility(View.GONE);
            if(demo){
                phoneVideo.stopPlayback();phoneVideo.setVisibility(View.GONE);
                phoneTest.setVisibility(View.VISIBLE);phoneTest.animate(playing);
            }else{
                phoneTest.animate(false);phoneTest.setVisibility(View.GONE);phoneVideo.setVisibility(View.VISIBLE);
                load(phoneVideo,videoUri,position,playing);
            }
        }else{
            try{
                if(external==null||external.getDisplay().getDisplayId()!=d.getDisplayId()){
                    closeExternal();external=new ExternalPlayer(this,d);external.show();
                }
                phoneVideo.stopPlayback();phoneVideo.setVisibility(View.GONE);
                phoneTest.animate(false);phoneTest.setVisibility(View.GONE);
                placeholder.setVisibility(View.VISIBLE);
                if(demo)external.showTest(playing);else external.showVideo(videoUri,position,playing);
            }catch(Exception e){
                closeExternal();externalOutput=false;route(position);
                message("Display failed","Android refused output on this screen: "+e.getMessage());
            }
        }
        updateOutput();updateControls();
    }
    private void load(VideoView target,Uri uri,int pos,boolean shouldPlay){
        if(uri==null)return;
        target.setOnPreparedListener(mp->{if(pos>0)target.seekTo(pos);if(shouldPlay)target.start();});
        target.setOnErrorListener((mp,what,extra)->{
            handler.post(()->message("Video playback problem","Could not play this source. Check internet connection, media codec or direct video link. Error "+what+"/"+extra));return true;
        });
        target.setVideoURI(uri);
    }
    private void togglePlay(){
        playing=!playing;
        if(demo){if(external!=null)external.setTestRunning(playing);else phoneTest.animate(playing);}
        else if(activeVideo()!=null){if(playing)activeVideo().start();else activeVideo().pause();}
        updateControls();
    }
    private void toggleOutput(){
        if(external==null&&displays.isEmpty()){
            message("No external display","Android sees no compatible secondary display. You can still play video on the phone or share it through the Wi-Fi browser receiver.");return;
        }
        int pos=currentPosition();externalOutput=!externalOutput;route(pos);
    }
    private VideoView activeVideo(){return external!=null?external.player:phoneVideo;}
    private int currentPosition(){
        if(demo)return 0;
        VideoView v=activeVideo();int ms=v==null?0:v.getCurrentPosition();
        return ms>0?ms:position;
    }
    private void updateOutput(){
        if(playingWhere==null)return;
        playingWhere.setText(external!=null?"Playing on "+external.getDisplay().getName():"Playing on the phone");
        outputButton.setText(external!=null?"Use phone screen":"Send to display");
    }
    private void updateControls(){
        if(playButton==null)return;
        playButton.setText(playing?"Pause":"Play");
        if(demo){seek.setEnabled(false);seek.setProgress(0);clock.setText("Offline animated test • "+(playing?"playing":"paused"));return;}
        VideoView v=activeVideo();int duration=v==null?0:Math.max(0,v.getDuration());
        seek.setEnabled(duration>0);
        if(duration>0){
            int pos=Math.min(currentPosition(),duration);
            seek.setMax(duration);if(!seeking)seek.setProgress(pos);
            clock.setText(time(pos)+" / "+time(duration));
        }else clock.setText("Opening video…");
    }
    private String time(int milliseconds){int s=Math.max(0,milliseconds)/1000;return (s/60)+":"+String.format(Locale.US,"%02d",s%60);}
    private void chooseVideo(){
        Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("video/*");
        startActivityForResult(i,42);
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=42||result!=RESULT_OK||data==null||data.getData()==null)return;
        Uri uri=data.getData();
        try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){}
        localVideo=uri;
        if(receiver!=null)receiver.setVideo(uri);
        playUri(uri,"Video from my phone");
        updateWifiStatus();
    }
    private void askVideoUrl(){
        EditText field=new EditText(this);field.setHint("https://site.com/movie.mp4");
        field.setSingleLine(true);field.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        new AlertDialog.Builder(this).setTitle("Play a video URL").setView(field)
            .setPositiveButton("Play",(dialog,n)->{
                Uri uri=Uri.parse(field.getText().toString().trim());
                if("https".equals(uri.getScheme())&&uri.getHost()!=null)playUri(uri,"Video from URL");
                else message("Invalid URL","Use a direct HTTPS media URL, not a web page.");
            }).setNegativeButton("Cancel",null).show();
    }
    private void toggleReceiver(){
        if(receiver!=null){receiver.close();receiver=null;}
        else{
            try{receiver=new WifiReceiver(this,localVideo);receiver.start();}
            catch(Exception e){if(receiver!=null)receiver.close();receiver=null;message("Receiver unavailable",String.valueOf(e.getMessage()));}
        }
        updateWifiStatus();
    }
    private void updateWifiStatus(){
        if(wifiState==null)return;
        wifiState.setText(receiver==null?"Receiver not started":
            "Receiver active. Open on the HDMI-connected TV/PC (same Wi-Fi):\n"+receiver.link()+
            (localVideo==null?"\nChoose a video to make a personal video available. Public samples also work.":"\nChosen phone video is ready."));
    }
    private void copyAddress(){
        if(receiver==null){message("Start the receiver","Tap Start / stop Wi-Fi video receiver first.");return;}
        ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("HDMI Connect",receiver.link()));
        Toast.makeText(this,"Link copied",Toast.LENGTH_SHORT).show();
    }
    private void openCast(){
        try{startActivity(new Intent(Settings.ACTION_CAST_SETTINGS));}
        catch(Exception ignored){startActivity(new Intent(Settings.ACTION_SETTINGS));}
    }
    private void openDisplayLink(){
        try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("market://details?id=com.displaylink.presenter")));}
        catch(Exception ignored){startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://play.google.com/store/apps/details?id=com.displaylink.presenter")));}
    }
    private void closeExternal(){
        if(external==null)return;
        external.shutdown();
        try{external.dismiss();}catch(Exception ignored){}
        external=null;
    }
    private void message(String title,String body){
        if(isFinishing()||isDestroyed())return;
        new AlertDialog.Builder(this).setTitle(title).setMessage(body).setPositiveButton("OK",null).show();
    }
    private static final class ExternalPlayer extends Presentation{
        VideoView player;TestView test;
        ExternalPlayer(Context context,Display display){super(context,display);}
        @Override protected void onCreate(Bundle saved){
            super.onCreate(saved);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            FrameLayout frame=new FrameLayout(getContext());frame.setBackgroundColor(Color.BLACK);
            player=new VideoView(getContext());test=new TestView(getContext());
            frame.addView(player,new FrameLayout.LayoutParams(-1,-1));
            frame.addView(test,new FrameLayout.LayoutParams(-1,-1));
            setContentView(frame);
        }
        void showTest(boolean run){player.stopPlayback();player.setVisibility(View.GONE);test.setVisibility(View.VISIBLE);test.animate(run);}
        void showVideo(Uri uri,int pos,boolean shouldPlay){
            test.animate(false);test.setVisibility(View.GONE);player.setVisibility(View.VISIBLE);
            player.setOnPreparedListener(mp->{if(pos>0)player.seekTo(pos);if(shouldPlay)player.start();});
            player.setOnErrorListener((mp,what,extra)->true);
            if(uri!=null)player.setVideoURI(uri);
        }
        void setTestRunning(boolean value){test.animate(value);}
        void shutdown(){test.animate(false);player.stopPlayback();}
        @Override public void onStop(){shutdown();super.onStop();}
    }
}
