package com.coredelivery.rider;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.PowerManager;
import android.content.Context;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock cpuWakeLock;
    private PermissionRequest pendingPermissionRequest;

    // Runtime permission launcher for camera
    private final ActivityResultLauncher<String> cameraPermissionLauncher =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (pendingPermissionRequest != null) {
                if (granted) {
                    pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
                } else {
                    pendingPermissionRequest.deny();
                }
                pendingPermissionRequest = null;
            }
        });

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            cpuWakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "coredelivery:tracking"
            );
        }

        // Wrap the existing Capacitor WebChromeClient to add camera permission handling
        // without losing Capacitor's built-in permission management (GPS, geolocation, etc.)
        final WebChromeClient original = (WebChromeClient) getBridge().getWebView().getWebChromeClient();

        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            // Delegate ALL methods to the original Capacitor client by default.
            // We only override onPermissionRequest to add camera support.

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                String[] resources = request.getResources();
                boolean needsCamera = false;
                for (String r : resources) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                        needsCamera = true;
                        break;
                    }
                }

                if (needsCamera) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(resources);
                    } else {
                        pendingPermissionRequest = request;
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA);
                    }
                } else if (original != null) {
                    // Let Capacitor handle non-camera permissions (geolocation, etc.)
                    original.onPermissionRequest(request);
                } else {
                    request.grant(resources);
                }
            }

            // Forward geolocation permissions to Capacitor's handler
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                if (original != null) {
                    original.onGeolocationPermissionsShowPrompt(origin, callback);
                } else {
                    callback.invoke(origin, true, false);
                }
            }

            // Forward console messages (Capacitor uses these for logging)
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage consoleMessage) {
                if (original != null) return original.onConsoleMessage(consoleMessage);
                return super.onConsoleMessage(consoleMessage);
            }

            // Forward JS dialogs
            @Override
            public boolean onJsAlert(android.webkit.WebView view, String url, String message, android.webkit.JsResult result) {
                if (original != null) return original.onJsAlert(view, url, message, result);
                return super.onJsAlert(view, url, message, result);
            }

            @Override
            public boolean onJsConfirm(android.webkit.WebView view, String url, String message, android.webkit.JsResult result) {
                if (original != null) return original.onJsConfirm(view, url, message, result);
                return super.onJsConfirm(view, url, message, result);
            }

            @Override
            public boolean onJsPrompt(android.webkit.WebView view, String url, String message, String defaultValue, android.webkit.JsPromptResult result) {
                if (original != null) return original.onJsPrompt(view, url, message, defaultValue, result);
                return super.onJsPrompt(view, url, message, defaultValue, result);
            }

            // Forward file chooser (for input type=file)
            @Override
            public boolean onShowFileChooser(android.webkit.WebView webView, android.webkit.ValueCallback<android.net.Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (original != null) return original.onShowFileChooser(webView, filePathCallback, fileChooserParams);
                return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
            }

            // Forward create window requests
            @Override
            public boolean onCreateWindow(android.webkit.WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                if (original != null) return original.onCreateWindow(view, isDialog, isUserGesture, resultMsg);
                return super.onCreateWindow(view, isDialog, isUserGesture, resultMsg);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (cpuWakeLock != null && !cpuWakeLock.isHeld()) {
            cpuWakeLock.acquire(8 * 60 * 60 * 1000L);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
    }

    @Override
    public void onDestroy() {
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
            cpuWakeLock.release();
        }
        super.onDestroy();
    }
}
