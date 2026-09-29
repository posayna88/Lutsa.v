package com.lutsa.social;

import android.content.Context;
import android.content.SharedPreferences;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public class LutsaFirebaseMessagingService extends FirebaseMessagingService {
    private static final String PREFS = "lutsa_secure";
    private static final String NATIVE_ACCESS = "native_access_token";
    private static final String FCM_TOKEN = "fcm_token";

    @Override public void onNewToken(String token) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(FCM_TOKEN, token).apply();
        String access = getSharedPreferences(PREFS, MODE_PRIVATE).getString(NATIVE_ACCESS, "");
        if (access != null && !access.isEmpty()) updateServerToken(access, token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        String kind = d.get("kind");
        String title = d.get("title");
        String body = d.get("body");
        String url = d.get("url");
        if ("call".equalsIgnoreCase(kind) && d.get("callId") != null && !d.get("callId").isEmpty()) {
            NotificationHelper.showIncomingCall(this, d.get("callId"), d.get("callerName"), d.get("callType"));
            return;
        }
        NotificationHelper.showGeneral(this, title, body, url);
    }

    private void updateServerToken(String accessToken, String token) {
        try {
            String base = BuildConfig.BASE_URL.endsWith("/") ? BuildConfig.BASE_URL : BuildConfig.BASE_URL + "/";
            URL url = new URL(base + "api/push/native/register-token");
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setConnectTimeout(7000); c.setReadTimeout(7000);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + accessToken);
            byte[] body = new JSONObject().put("fcmToken", token).toString().getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = c.getOutputStream()) { out.write(body); }
            c.getResponseCode(); c.disconnect();
        } catch (Exception ignored) {}
    }
}
