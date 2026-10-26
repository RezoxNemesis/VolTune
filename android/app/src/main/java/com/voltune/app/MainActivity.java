package com.voltune.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeTtsPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        super.onCreate(savedInstanceState);

        // Cross-origin isolation lets the WebAssembly fallback use several threads.
        getBridge()
            .setWebViewClient(
                new BridgeWebViewClient(getBridge()) {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        WebResourceResponse res = super.shouldInterceptRequest(view, request);
                        if (res != null) {
                            Map<String, String> headers = new HashMap<>();
                            if (res.getResponseHeaders() != null) headers.putAll(res.getResponseHeaders());
                            headers.put("Cross-Origin-Opener-Policy", "same-origin");
                            headers.put("Cross-Origin-Embedder-Policy", "credentialless");
                            res.setResponseHeaders(headers);
                        }
                        return res;
                    }
                }
            );
    }
}
