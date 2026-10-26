package com.voltune.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** Lets the person choose where to save a finished audio file (the system "Save as" dialog). */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String path = call.getString("path");
        String name = call.getString("name", "voltune.wav");
        String mime = call.getString("mime", "audio/wav");
        if (path == null) {
            call.reject("path is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onPicked");
    }

    @ActivityCallback
    private void onPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri dest = result.getData().getData();
        String raw = call.getString("path");
        String filePath = raw != null && raw.startsWith("file://") ? Uri.parse(raw).getPath() : raw;
        try (InputStream in = new FileInputStream(new File(filePath)); OutputStream out = getContext().getContentResolver().openOutputStream(dest)) {
            if (out == null) throw new Exception("Cannot open the chosen location");
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            JSObject res = new JSObject();
            res.put("uri", dest.toString());
            call.resolve(res);
        } catch (Throwable e) {
            call.reject("Could not save the file: " + e.getMessage());
        }
    }
}
