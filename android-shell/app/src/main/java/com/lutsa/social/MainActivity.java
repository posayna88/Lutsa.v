package com.lutsa.social;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Window;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 7001;
    private static final int POST_NOTIFICATIONS = 7002;
    private static final String CHANNEL = "lutsa_general";
    private static final String CALL_CHANNEL = "lutsa_calls";
    private static final String PREFS = "lutsa_secure";
    private static final String BIOMETRIC_ENABLED = "biometric_enabled";
    private static final long LOCK_AFTER_MS = 30_000L;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private long backgroundAt = 0L;
    private boolean authInProgress = false;
    private boolean firstResume = true;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        NotificationHelper.createChannels(this);
        createNotificationChannel();
        webView = new WebView(this);
        setContentView(webView);
        configureWebView();
        enterImmersiveMode();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, POST_NOTIFICATIONS);
        }
        if (state == null) webView.loadUrl(BuildConfig.BASE_URL);
        else webView.restoreState(state);
        handleIntent(getIntent());
        loadFcmToken();
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setBackgroundColor(Color.BLACK);
        webView.addJavascriptInterface(new NativeBridge(), "LutsaNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return handleExternalNavigation(req.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                try { return handleExternalNavigation(Uri.parse(url)); } catch (Exception ignored) { return true; }
            }
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                syncFcmTokenToWeb();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(() -> {
                    String origin = req.getOrigin() == null ? "" : req.getOrigin().toString();
                    String base = BuildConfig.BASE_URL;
                    if (origin.startsWith(base)) req.grant(req.getResources());
                    else req.deny();
                });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = params.createIntent();
                i.addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(i, FILE_CHOOSER); return true; }
                catch(Exception e) { fileCallback=null; return false; }
            }
        });
    }

    private boolean handleExternalNavigation(Uri u) {
        if (u == null) return true;
        try {
            Uri base = Uri.parse(BuildConfig.BASE_URL);
            if (base.getHost() != null && base.getHost().equalsIgnoreCase(u.getHost())) return false;
            if ("lutsa".equalsIgnoreCase(u.getScheme())) { handleIntent(new Intent(Intent.ACTION_VIEW, u)); return true; }
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch(Exception ignored) {}
        return true;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel c = new NotificationChannel(CHANNEL, getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_HIGH);
            c.setDescription("LUTSA messages and call alerts");
            NotificationChannel call = new NotificationChannel(CALL_CHANNEL, "LUTSA المكالمات", NotificationManager.IMPORTANCE_HIGH);
            call.setDescription("مكالمات LUTSA الواردة");
            call.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(c);
            nm.createNotificationChannel(call);
        }
    }

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private void handleIntent(Intent i) {
        if (i == null) return;
        String action = i.getStringExtra("lutsa_call_action");
        String callId = i.getStringExtra("lutsa_call_id");
        if (action != null && callId != null) {
            String target = BuildConfig.BASE_URL + "?callAction=" + Uri.encode(action) + "&callId=" + Uri.encode(callId);
            webView.loadUrl(target);
            return;
        }
        String appUrl = i.getStringExtra("lutsa_url");
        if (appUrl != null) {
            String target = resolveUrl(appUrl);
            if (target != null) webView.loadUrl(target);
            return;
        }
        Uri data=i.getData();
        if(data!=null && "lutsa".equalsIgnoreCase(data.getScheme())) {
            String target=data.getQueryParameter("url");
            if(target!=null) {
                String safe=resolveUrl(target);
                if(safe!=null) webView.loadUrl(safe);
            }
        }
    }

    private String resolveUrl(String url) {
        if (url == null || url.isEmpty()) return BuildConfig.BASE_URL;
        if (url.startsWith("http://") || url.startsWith("https://")) return url.startsWith(BuildConfig.BASE_URL) ? url : BuildConfig.BASE_URL;
        return BuildConfig.BASE_URL + (url.startsWith("/") ? url.substring(1) : url);
    }

    private void enterImmersiveMode() {
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON, WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if(hasFocus) enterImmersiveMode(); }

    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent); }
    @Override protected void onSaveInstanceState(Bundle out) { webView.saveState(out); super.onSaveInstanceState(out); }
    @Override protected void onActivityResult(int req,int result,Intent data){
        super.onActivityResult(req,result,data);
        if(req==FILE_CHOOSER&&fileCallback!=null){
            Uri[] r=null;
            if(result==RESULT_OK&&data!=null){
                if(data.getClipData()!=null){int n=data.getClipData().getItemCount();r=new Uri[n];for(int j=0;j<n;j++)r[j]=data.getClipData().getItemAt(j).getUri();}
                else if(data.getData()!=null)r=new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(r);fileCallback=null;
        }
    }

    @Override protected void onPause() { super.onPause(); backgroundAt = SystemClock.elapsedRealtime(); }
    @Override protected void onResume() { super.onResume();
        if (!firstResume && backgroundAt > 0 && SystemClock.elapsedRealtime() - backgroundAt >= LOCK_AFTER_MS) maybeAuthenticate();
        firstResume = false;
    }

    private void syncFcmTokenToWeb(){
        String token=prefs().getString("fcm_token","");
        if(token==null||token.isEmpty()||webView==null) return;
        String safe=org.json.JSONObject.quote(token);
        webView.evaluateJavascript("window.lutsaRegisterNativeFcmToken && window.lutsaRegisterNativeFcmToken("+safe+")",null);
    }
    private void loadFcmToken(){
        try{
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token->{
                if(token!=null&&!token.isEmpty()){prefs().edit().putString("fcm_token",token).apply(); syncFcmTokenToWeb();}
            });
        }catch(Exception ignored){}
    }

    private boolean biometricAvailable() {
        return Build.VERSION.SDK_INT >= 28 && getPackageManager().hasSystemFeature("android.hardware.fingerprint");
    }

    private void maybeAuthenticate() {
        if (!prefs().getBoolean(BIOMETRIC_ENABLED, false) || !biometricAvailable() || authInProgress) return;
        if (Build.VERSION.SDK_INT < 28) return;
        try {
            android.hardware.biometrics.BiometricPrompt prompt = new android.hardware.biometrics.BiometricPrompt.Builder(this)
                    .setTitle(getString(R.string.biometric_title))
                    .setSubtitle(getString(R.string.biometric_subtitle))
                    .setDescription(getString(R.string.biometric_description))
                    .setNegativeButton(getString(R.string.biometric_cancel), getMainExecutor(), (dialog, which) -> finish())
                    .build();
            authInProgress = true;
            prompt.authenticate(new android.os.CancellationSignal(), getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult result) { authInProgress=false; }
                @Override public void onAuthenticationError(int errorCode, CharSequence errString) { authInProgress=false; if(errorCode != 5) finish(); }
                @Override public void onAuthenticationFailed() { }
            });
        } catch (Exception e) { authInProgress=false; }
    }

    public class NativeBridge {
        @android.webkit.JavascriptInterface public boolean isAndroid() { return true; }
        @android.webkit.JavascriptInterface public boolean isBiometricAvailable() { return biometricAvailable(); }
        @android.webkit.JavascriptInterface public boolean isBiometricEnabled() { return prefs().getBoolean(BIOMETRIC_ENABLED, false); }
        @android.webkit.JavascriptInterface public void setBiometricEnabled(boolean enabled) {
            if (enabled && !biometricAvailable()) return;
            prefs().edit().putBoolean(BIOMETRIC_ENABLED, enabled).apply();
        }
        @android.webkit.JavascriptInterface public String getFcmToken() { return prefs().getString("fcm_token", ""); }
        @android.webkit.JavascriptInterface public void saveNativeAccessToken(String token) { if(token==null||token.isEmpty()) return; prefs().edit().putString("native_access_token",token).apply(); }
        @android.webkit.JavascriptInterface public void revokeNativeAccessToken() { prefs().edit().remove("native_access_token").apply(); }

        @android.webkit.JavascriptInterface public void openAppSettings() {
            try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch(Exception ignored) {}
        }
        @android.webkit.JavascriptInterface public void setCallActive(boolean active) { if (active) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); }
        @android.webkit.JavascriptInterface public void notify(String title,String body,String url){
            NotificationHelper.showGeneral(MainActivity.this,title,body,resolveUrl(url));
        }
        @android.webkit.JavascriptInterface public void notifyIncomingCall(String callId, String caller, String type){
            NotificationHelper.showIncomingCall(MainActivity.this, callId, caller, type);
        }
        @android.webkit.JavascriptInterface public void clearCallNotification(String callId){
            NotificationHelper.clearCall(MainActivity.this,callId);
        }
    }

    @Override public void onBackPressed(){ if(webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }
}
