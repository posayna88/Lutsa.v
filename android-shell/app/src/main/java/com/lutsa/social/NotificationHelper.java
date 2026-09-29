package com.lutsa.social;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

public final class NotificationHelper {
    public static final String GENERAL_CHANNEL = "lutsa_general";
    public static final String CALL_CHANNEL = "lutsa_calls";
    public static final int GENERAL_ID_BASE = 100000;

    private NotificationHelper() {}

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel general = new NotificationChannel(GENERAL_CHANNEL, "LUTSA", NotificationManager.IMPORTANCE_HIGH);
        general.setDescription("LUTSA messages and alerts");
        NotificationChannel call = new NotificationChannel(CALL_CHANNEL, "LUTSA المكالمات", NotificationManager.IMPORTANCE_HIGH);
        call.setDescription("مكالمات LUTSA الواردة");
        call.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(general);
        nm.createNotificationChannel(call);
    }

    private static boolean canNotify(Context context) {
        return Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    public static void showGeneral(Context context, String title, String body, String url) {
        if (!canNotify(context)) return;
        createChannels(context);
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("lutsa_url", url == null ? "/" : url);
        PendingIntent pi = PendingIntent.getActivity(context, stableCode(title + body, "open"), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, GENERAL_CHANNEL) : new Notification.Builder(context);
        b.setSmallIcon(R.drawable.lutsa_icon)
                .setContentTitle(title == null ? "LUTSA" : title)
                .setContentText(body == null ? "" : body)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(Notification.PRIORITY_HIGH);
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(GENERAL_ID_BASE + stableCode(title + body, "notification"), b.build());
    }

    public static void showIncomingCall(Context context, String callId, String caller, String type) {
        if (callId == null || callId.isEmpty() || !canNotify(context)) return;
        createChannels(context);
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("lutsa_call_action", "open");
        open.putExtra("lutsa_call_id", callId);
        PendingIntent openPi = PendingIntent.getActivity(context, stableCode(callId, "open"), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent accept = new Intent(context, CallActionReceiver.class);
        accept.setAction(CallActionReceiver.ACTION_ACCEPT);
        accept.putExtra("call_id", callId);
        PendingIntent acceptPi = PendingIntent.getBroadcast(context, stableCode(callId, "accept"), accept, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent reject = new Intent(context, CallActionReceiver.class);
        reject.setAction(CallActionReceiver.ACTION_REJECT);
        reject.putExtra("call_id", callId);
        PendingIntent rejectPi = PendingIntent.getBroadcast(context, stableCode(callId, "reject"), reject, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = "video".equalsIgnoreCase(type) ? "🎥 مكالمة فيديو واردة" : "📞 مكالمة صوتية واردة";
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CALL_CHANNEL) : new Notification.Builder(context);
        b.setSmallIcon(R.drawable.lutsa_icon)
                .setContentTitle(title)
                .setContentText(caller == null || caller.isEmpty() ? "مكالمة واردة" : caller)
                .setCategory(Notification.CATEGORY_CALL)
                .setPriority(Notification.PRIORITY_MAX)
                .setAutoCancel(false)
                .setOngoing(true)
                .setFullScreenIntent(openPi, true)
                .setContentIntent(openPi)
                .addAction(new Notification.Action.Builder(0, "✅ قبول", acceptPi).build())
                .addAction(new Notification.Action.Builder(0, "❌ رفض", rejectPi).build());
        if (Build.VERSION.SDK_INT >= 31) {
            android.app.Person person = new android.app.Person.Builder().setName(caller == null ? "LUTSA" : caller).build();
            b.setStyle(Notification.CallStyle.forIncomingCall(person, rejectPi, acceptPi));
        }
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(callNotificationId(callId), b.build());
    }

    public static void clearCall(Context context, String callId) {
        if (callId == null || callId.isEmpty()) return;
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(callNotificationId(callId));
    }

    public static int callNotificationId(String callId) { return Math.abs(("call:" + callId).hashCode()); }
    public static int stableCode(String id, String action) { return Math.abs((id + ":" + action).hashCode()); }
}
