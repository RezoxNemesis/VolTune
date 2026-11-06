package com.rezox.hdmiconnect;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

public final class WifiReceiver {
    private final Context context;
    private final String secret;
    private final ExecutorService workers=Executors.newFixedThreadPool(3);
    private volatile Uri video;
    private volatile boolean online;
    private ServerSocket socket;
    private String address;
    WifiReceiver(Context context,Uri uri){
        this.context=context.getApplicationContext();this.video=uri;
        byte[] bytes=new byte[12];new SecureRandom().nextBytes(bytes);
        StringBuilder b=new StringBuilder();for(byte c:bytes)b.append(String.format(Locale.US,"%02x",c&255));
        secret=b.toString();
    }
    void setVideo(Uri uri){video=uri;}
    void start() throws IOException{
        socket=new ServerSocket(0);
        online=true;
        address="http://"+ip()+":"+socket.getLocalPort()+"/?code="+secret;
        Thread accept=new Thread(()->{
            while(online){
                try{Socket client=socket.accept();workers.execute(()->handle(client));}
                catch(Exception ignored){}
            }
        },"hdmi-wifi-receiver");
        accept.setDaemon(true);accept.start();
    }
    String link(){return address;}
    void close(){
        online=false;
        try{if(socket!=null)socket.close();}catch(Exception ignored){}
        workers.shutdownNow();
    }
    private static String ip(){
        String backup=null;
        try{
            Enumeration<NetworkInterface> it=NetworkInterface.getNetworkInterfaces();
            while(it.hasMoreElements()){
                NetworkInterface network=it.nextElement();
                if(!network.isUp()||network.isLoopback())continue;
                Enumeration<InetAddress> addresses=network.getInetAddresses();
                while(addresses.hasMoreElements()){
                    InetAddress a=addresses.nextElement();
                    if(!(a instanceof Inet4Address)||a.isLoopbackAddress())continue;
                    if(network.getName().startsWith("wlan")||network.getName().startsWith("ap")||network.getName().startsWith("swlan")||network.getName().startsWith("eth"))return a.getHostAddress();
                    if(backup==null&&a.isSiteLocalAddress())backup=a.getHostAddress();
                }
            }
        }catch(Exception ignored){}
        return backup==null?"PHONE_WIFI_IP":backup;
    }
    private String line(InputStream in) throws IOException{
        StringBuilder b=new StringBuilder();int ch=-1;
        while(b.length()<8192&&(ch=in.read())>=0){if(ch==10)break;if(ch!=13)b.append((char)ch);}
        if(b.length()==0&&ch<0)return null;
        return b.toString();
    }
    private void handle(Socket peer){
        try(Socket client=peer){
            client.setSoTimeout(10000);
            InputStream in=new BufferedInputStream(client.getInputStream());
            OutputStream out=new BufferedOutputStream(client.getOutputStream());
            String request=line(in);
            if(request==null)return;
            String[] fields=request.split(" ");
            if(fields.length<2||!fields[0].equals("GET")){writeText(out,405,"Method Not Allowed","GET only");return;}
            String path=fields[1],range=null;
            for(int i=0;i<40;i++){
                String h=line(in);
                if(h==null||h.isEmpty())break;
                if(h.toLowerCase(Locale.ROOT).startsWith("range:"))range=h.substring(6).trim();
            }
            if(!path.contains("code="+secret)){writeText(out,403,"Forbidden","Use the paired link shown on your phone.");return;}
            if(path.startsWith("/video"))sendVideo(out,range);
            else if(path.startsWith("/"))sendHtml(out);
            else writeText(out,404,"Not Found","Missing page");
        }catch(Exception ignored){}
    }
    private void header(OutputStream out,int status,String label,String mime,long bytes,String extra) throws IOException{
        String response="HTTP/1.1 "+status+" "+label+"\r\n"+
            "Content-Type: "+mime+"\r\nContent-Length: "+bytes+"\r\nCache-Control: no-store\r\n"+
            "X-Content-Type-Options: nosniff\r\nConnection: close\r\n"+(extra==null?"":extra)+"\r\n";
        out.write(response.getBytes(StandardCharsets.US_ASCII));
    }
    private void writeText(OutputStream out,int status,String label,String message) throws IOException{
        byte[] b=message.getBytes(StandardCharsets.UTF_8);header(out,status,label,"text/plain; charset=utf-8",b.length,null);out.write(b);out.flush();
    }
    private void sendHtml(OutputStream out) throws IOException{
        String page="<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"+
            "<title>HDMI Connect Receiver</title><style>body{background:#081223;color:#eaf3ff;font:16px system-ui;padding:18px;max-width:960px;margin:auto}video{width:100%;max-height:75vh;background:black;border-radius:12px}"+
            "button{background:#3178e8;color:#fff;border:0;border-radius:10px;padding:12px 16px;margin:8px 8px 0 0}p{color:#bbcadc}</style>"+
            "<h1>HDMI Connect</h1><p>Choose a video below and press Play. Keep the receiver running on your phone.</p>"+
            "<video id='v' controls playsinline></video><div>"+
            (video==null?"":"<button onclick=\"load('/video?code="+secret+"')\">Phone video</button>")+
            "<button onclick=\"load('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4')\">Nature</button>"+
            "<button onclick=\"load('https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4')\">Bunny</button>"+
            "<button onclick=\"load('https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4')\">Elephant Dream</button></div>"+
            "<p>Local network only. A plain monitor cannot access this receiver without a browser-equipped device.</p>"+
            "<script>function load(u){let v=document.getElementById('v');v.src=u;v.load();v.play().catch(()=>{});}</script></html>";
        byte[] b=page.getBytes(StandardCharsets.UTF_8);
        header(out,200,"OK","text/html; charset=utf-8",b.length,null);out.write(b);out.flush();
    }
    private long length(Uri uri){
        try(Cursor c=context.getContentResolver().query(uri,new String[]{OpenableColumns.SIZE},null,null,null)){
            if(c!=null&&c.moveToFirst()&&!c.isNull(0))return c.getLong(0);
        }catch(Exception ignored){}
        try(ParcelFileDescriptor fd=context.getContentResolver().openFileDescriptor(uri,"r")){if(fd!=null)return fd.getStatSize();}
        catch(Exception ignored){}
        return -1;
    }
    private void sendVideo(OutputStream out,String range) throws IOException{
        Uri uri=video;
        if(uri==null){writeText(out,404,"Not Found","Choose a local video on the phone first");return;}
        long size=length(uri);
        if(size<1){writeText(out,422,"Unprocessable Entity","File size unknown");return;}
        long start=0,end=size-1;
        boolean partial=range!=null&&range.startsWith("bytes=");
        if(partial){
            try{
                String[] parts=range.substring(6).split(",")[0].split("-", -1);
                if(parts[0].isEmpty())start=Math.max(0,size-Long.parseLong(parts[1]));
                else{start=Long.parseLong(parts[0]);if(parts.length>1&&!parts[1].isEmpty())end=Long.parseLong(parts[1]);}
            }catch(Exception error){partial=false;start=0;end=size-1;}
        }
        if(start>=size||start<0||end<start){
            out.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */"+size+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.flush();return;
        }
        end=Math.min(end,size-1);
        String mime=context.getContentResolver().getType(uri);
        if(mime==null||!mime.startsWith("video/"))mime="video/mp4";
        header(out,partial?206:200,partial?"Partial Content":"OK",mime,end-start+1,
            "Accept-Ranges: bytes\r\n"+(partial?"Content-Range: bytes "+start+"-"+end+"/"+size+"\r\n":""));
        try(InputStream stream=context.getContentResolver().openInputStream(uri)){
            if(stream==null)return;
            long skipped=0;
            while(skipped<start){long n=stream.skip(start-skipped);if(n<=0){if(stream.read()<0)return;n=1;}skipped+=n;}
            byte[] data=new byte[65536];long remaining=end-start+1;
            while(remaining>0&&online){int n=stream.read(data,0,(int)Math.min(data.length,remaining));if(n<0)break;out.write(data,0,n);remaining-=n;}
            out.flush();
        }
    }
}
