package com.lutsa.social;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_ACCEPT = "com.lutsa.social.CALL_ACCEPT";
    public static final String ACTION_REJECT = "com.lutsa.social.CALL_REJECT";
    public static final String ACTION_END = "com.lutsa.social.CALL_END";
    private static final String PREFS = "lutsa_secure";
    private static final String NATIVE_ACCESS = "native_access_token";

    @Override public void onReceive(Context context, Intent intent) {
        final String callId = intent.getStringExtra("call_id");
        if (callId == null || callId.isEmpty()) return;
        final String action = intent.getAction();
        NotificationHelper.clearCall(context, callId);
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try { postAction(context, callId, actionToServerAction(action)); } catch (Exception ignored) {}
            finally {
                if (ACTION_ACCEPT.equals(action) || ACTION_END.equals(action)) {
                    Intent open = new Intent(context, MainActivity.class);
                    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    open.putExtra("lutsa_call_action", ACTION_ACCEPT.equals(action) ? "accept" : "end");
                    open.putExtra("lutsa_call_id", callId);
                    context.startActivity(open);
                }
                pending.finish();
            }
        }).start();
    }

    private static String actionToServerAction(String action) {
        if (ACTION_ACCEPT.equals(action)) return "accept";
        if (ACTION_END.equals(action)) return "end";
        return "reject";
    }

    private static void postAction(Context context, String callId, String action) throws Exception {
        SharedPreferences p=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
        String access=p.getString(NATIVE_ACCESS,""); if(access.isEmpty()) return;
        String base=BuildConfig.BASE_URL.endsWith("/")?BuildConfig.BASE_URL:BuildConfig.BASE_URL+"/";
        HttpURLConnection c=(HttpURLConnection)new URL(base+"api/calls/action").openConnection();
        c.setRequestMethod("POST"); c.setDoOutput(true); c.setConnectTimeout(7000); c.setReadTimeout(7000);
        c.setRequestProperty("Content-Type","application/json"); c.setRequestProperty("Authorization","Bearer "+access);
        byte[] b=new JSONObject().put("callId",callId).put("action",action).toString().getBytes(StandardCharsets.UTF_8);
        c.setFixedLengthStreamingMode(b.length); try(OutputStream out=c.getOutputStream()){out.write(b);} c.getResponseCode(); c.disconnect();
    }
}
