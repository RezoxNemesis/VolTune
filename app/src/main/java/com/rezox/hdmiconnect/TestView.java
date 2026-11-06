package com.rezox.hdmiconnect;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.View;
import java.util.Locale;

public final class TestView extends View {
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean active=false;
    private float frozen=0, offset=0;
    TestView(Context c){super(c);}
    void animate(boolean enabled){
        if(enabled==active)return;
        if(!enabled)frozen=time();
        else offset=SystemClock.uptimeMillis()/1000f-frozen;
        active=enabled;invalidate();
    }
    private float time(){return active?SystemClock.uptimeMillis()/1000f-offset:frozen;}
    @Override protected void onDraw(Canvas c){
        super.onDraw(c);
        float w=getWidth(),h=getHeight(),t=time();
        if(w<=0||h<=0)return;
        paint.setStyle(Paint.Style.FILL);
        paint.setShader(new LinearGradient(0,0,w,h,new int[]{0xff0b223e,0xff233b59,0xff071225},null,Shader.TileMode.CLAMP));
        c.drawRect(0,0,w,h,paint);paint.setShader(null);
        for(int i=0;i<20;i++){
            float a=i*.4f+t*.49f;
            float x=w*(.5f+.44f*(float)Math.sin(a));
            float y=h*(.5f+.33f*(float)Math.cos(a*.85f));
            paint.setColor(i%3==0?0xb35be2d6:i%3==1?0xa57897ff:0xaaffa974);
            c.drawCircle(x,y,h*(.012f+.008f*(i%4)),paint);
        }
        paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(Math.max(2,h*.007f));
        for(int i=0;i<5;i++){
            paint.setColor(i%2==0?0xff6ce9dd:0xff8ca8ff);
            c.drawCircle(w*.5f,h*.5f,h*(.15f+i*.095f)+7*(float)Math.sin(t+i),paint);
        }
        paint.setStyle(Paint.Style.FILL);paint.setTextAlign(Paint.Align.CENTER);
        paint.setColor(Color.WHITE);paint.setTypeface(Typeface.DEFAULT_BOLD);
        paint.setTextSize(Math.min(w*.075f,h*.11f));
        c.drawText("HDMI CONNECT",w*.5f,h*.52f,paint);
        paint.setTypeface(Typeface.DEFAULT);paint.setColor(0xffb5cde7);
        paint.setTextSize(Math.min(w*.032f,h*.05f));
        c.drawText("MOTION • COLOR • DISPLAY",w*.5f,h*.64f,paint);
        paint.setTextSize(Math.min(w*.024f,h*.04f));
        c.drawText(String.format(Locale.US,"FRAME %04d",Math.max(0,(int)(t*30))),w*.5f,h*.89f,paint);
        if(active)postInvalidateDelayed(33);
    }
}
