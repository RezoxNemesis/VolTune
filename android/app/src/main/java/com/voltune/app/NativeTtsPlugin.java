package com.voltune.app;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Runs the Kokoro ONNX model with native ONNX Runtime. The web layer still does text, phonemes and
 * tokens; this plugin only does the heavy neural step, which is several times faster than WebAssembly.
 */
@CapacitorPlugin(name = "NativeTts")
public class NativeTtsPlugin extends Plugin {

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();
    private OrtEnvironment env;
    private OrtSession session;
    private String idsName = "input_ids";
    private String styleName = "style";
    private String speedName = "speed";

    @PluginMethod
    public void init(final PluginCall call) {
        final String url = call.getString("modelUrl");
        final String fileName = call.getString("fileName", "kokoro-fp32.onnx");
        final int threads = call.getInt("threads", 4);
        if (url == null) {
            call.reject("modelUrl is required");
            return;
        }
        worker.execute(
            () -> {
                try {
                    long t0 = System.currentTimeMillis();
                    File dir = new File(getContext().getFilesDir(), "models");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create model folder");
                    File model = new File(dir, fileName);
                    File marker = new File(dir, fileName + ".ok");
                    if (!model.exists() || !marker.exists()) {
                        download(url, model, marker);
                    }
                    synchronized (lock) {
                        closeSession();
                        env = OrtEnvironment.getEnvironment();
                        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
                        opts.setIntraOpNumThreads(Math.max(1, threads));
                        opts.setInterOpNumThreads(1);
                        opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
                        session = env.createSession(model.getAbsolutePath(), opts);
                        for (String name : session.getInputNames()) {
                            String n = name.toLowerCase();
                            if (n.equals("input_ids") || n.equals("tokens")) idsName = name;
                            else if (n.equals("style")) styleName = name;
                            else if (n.equals("speed")) speedName = name;
                        }
                    }
                    JSObject res = new JSObject();
                    res.put("ready", true);
                    res.put("threads", threads);
                    res.put("ms", System.currentTimeMillis() - t0);
                    call.resolve(res);
                } catch (Throwable e) {
                    call.reject("Native engine failed to start: " + e.getMessage());
                }
            }
        );
    }

    private void download(String urlString, File target, File marker) throws Exception {
        File part = new File(target.getParentFile(), target.getName() + ".part");
        marker.delete();
        long have = part.exists() ? part.length() : 0;
        HttpURLConnection conn = (HttpURLConnection) new URL(urlString).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(30000);
        if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
        int code = conn.getResponseCode();
        if (code == 200) have = 0; // server ignored Range
        else if (code != 206) throw new Exception("Download failed (HTTP " + code + ")");
        long remaining = conn.getContentLengthLong();
        long total = remaining > 0 ? remaining + have : -1;
        long loaded = have;
        long lastNotify = 0;
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part, have > 0)) {
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                loaded += n;
                long now = System.currentTimeMillis();
                if (now - lastNotify > 250) {
                    lastNotify = now;
                    JSObject p = new JSObject();
                    p.put("loaded", loaded);
                    p.put("total", total);
                    notifyListeners("downloadProgress", p);
                }
            }
        }
        if (total > 0 && part.length() != total) throw new Exception("Download incomplete");
        if (target.exists() && !target.delete()) throw new Exception("Cannot replace old model");
        if (!part.renameTo(target)) throw new Exception("Cannot finalise model file");
        if (!marker.createNewFile()) throw new Exception("Cannot mark model ready");
        JSObject p = new JSObject();
        p.put("loaded", loaded);
        p.put("total", loaded);
        notifyListeners("downloadProgress", p);
    }

    @PluginMethod
    public void infer(final PluginCall call) {
        final JSArray idsArr = call.getArray("ids");
        final JSArray styleArr = call.getArray("style");
        final double speed = call.getDouble("speed", 1.0);
        if (idsArr == null || styleArr == null) {
            call.reject("ids and style are required");
            return;
        }
        worker.execute(
            () -> {
                try {
                    long t0 = System.currentTimeMillis();
                    int n = idsArr.length();
                    long[] ids = new long[n];
                    for (int i = 0; i < n; i++) ids[i] = idsArr.getLong(i);
                    float[] style = new float[styleArr.length()];
                    for (int i = 0; i < style.length; i++) style[i] = (float) styleArr.getDouble(i);

                    float[] wave;
                    synchronized (lock) {
                        if (session == null) throw new Exception("Native engine is not initialised");
                        Map<String, OnnxTensor> inputs = new HashMap<>();
                        OnnxTensor tIds = OnnxTensor.createTensor(env, LongBuffer.wrap(ids), new long[] { 1, n });
                        OnnxTensor tStyle = OnnxTensor.createTensor(env, FloatBuffer.wrap(style), new long[] { 1, style.length });
                        OnnxTensor tSpeed = OnnxTensor.createTensor(env, FloatBuffer.wrap(new float[] { (float) speed }), new long[] { 1 });
                        inputs.put(idsName, tIds);
                        inputs.put(styleName, tStyle);
                        inputs.put(speedName, tSpeed);
                        try (OrtSession.Result result = session.run(inputs)) {
                            OnnxTensor out = (OnnxTensor) result.get(0);
                            FloatBuffer fb = out.getFloatBuffer();
                            wave = new float[fb.remaining()];
                            fb.get(wave);
                        } finally {
                            tIds.close();
                            tStyle.close();
                            tSpeed.close();
                        }
                    }

                    ByteBuffer bb = ByteBuffer.allocate(wave.length * 2).order(ByteOrder.LITTLE_ENDIAN);
                    for (float f : wave) {
                        float c = Math.max(-1f, Math.min(1f, f));
                        bb.putShort((short) Math.round(c < 0 ? c * 32768f : c * 32767f));
                    }
                    JSObject res = new JSObject();
                    res.put("pcm", Base64.encodeToString(bb.array(), Base64.NO_WRAP));
                    res.put("samples", wave.length);
                    res.put("ms", System.currentTimeMillis() - t0);
                    call.resolve(res);
                } catch (Throwable e) {
                    call.reject("Native inference failed: " + e.getMessage());
                }
            }
        );
    }

    @PluginMethod
    public void release(PluginCall call) {
        synchronized (lock) {
            closeSession();
        }
        call.resolve();
    }

    private void closeSession() {
        try {
            if (session != null) session.close();
        } catch (Throwable ignored) {}
        session = null;
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (lock) {
            closeSession();
        }
        worker.shutdownNow();
        super.handleOnDestroy();
    }
}
