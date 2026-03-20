package PACKAGE_NAME

import android.app.ActivityManager
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class AlarmService : Service() {
  companion object {
    var wakeLock: PowerManager.WakeLock? = null
    private const val SVC_CHANNEL_ID   = "pomo-alarm-service"  // IMPORTANCE_LOW, silent — for startForeground
    private const val FSI_CHANNEL_ID   = "pomo-alarm-fsi"      // IMPORTANCE_HIGH, silent — FSI when device is locked
    private const val WORK_CHANNEL_ID  = "pomo-work-4"         // IMPORTANCE_MAX, with sound — heads-up when unlocked
    private const val BREAK_CHANNEL_ID = "pomo-break-4"
    private const val SVC_NOTIF_ID     = 9001
    const val ALARM_NOTIF_ID           = 9002
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // If the app is already in the foreground the JS timer handles everything — bail out
    // to prevent a double sound when the timer ends with the app open.
    if (isAppInForeground()) {
      stopSelf()
      return START_NOT_STICKY
    }

    val title = intent?.getStringExtra("title") ?: "Pomodoro"
    val body  = intent?.getStringExtra("body")  ?: ""

    // Acquire WakeLock with ACQUIRE_CAUSES_WAKEUP so the screen turns on
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock?.let { if (it.isHeld) it.release() }
    @Suppress("DEPRECATION")
    wakeLock = pm.newWakeLock(
      PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
      "pomo:alarmwakelock"
    ).also { it.acquire(10 * 60 * 1000L) }

    // Create notification channels if needed
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      // Silent low-importance channel — only used for the mandatory startForeground() notification
      if (nm.getNotificationChannel(SVC_CHANNEL_ID) == null) {
        NotificationChannel(SVC_CHANNEL_ID, "Alarm Service", NotificationManager.IMPORTANCE_LOW).also {
          it.setSound(null, null)
          it.enableVibration(false)
          nm.createNotificationChannel(it)
        }
      }
      // Silent HIGH-importance channel for the FSI notification.
      // FSI requires high (or max) importance to fire; we silence it so only
      // AlarmActivity's MediaPlayer plays audio (avoids double sound).
      if (nm.getNotificationChannel(FSI_CHANNEL_ID) == null) {
        NotificationChannel(FSI_CHANNEL_ID, "Alarm Alert", NotificationManager.IMPORTANCE_HIGH).also {
          it.setSound(null, null)
          it.enableVibration(false)
          nm.createNotificationChannel(it)
        }
      }
    }

    val silentNotif = NotificationCompat.Builder(this, SVC_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("Timer ended")
      .setOngoing(true)
      .setSilent(true)
      .build()

    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(SVC_NOTIF_ID, silentNotif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(SVC_NOTIF_ID, silentNotif)
    }

    // PendingIntent that opens AlarmActivity when the user taps the notification
    val activityPi = PendingIntent.getActivity(
      this, 0,
      Intent(this, AlarmActivity::class.java).apply {
        setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        putExtra("title", title)
        putExtra("body",  body)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    // Choose notification channel based on keyguard state:
    //   Locked   → FSI_CHANNEL_ID (silent, IMPORTANCE_HIGH): FSI delivers AlarmActivity, which plays sound
    //   Unlocked → alarm channel (IMPORTANCE_MAX, USAGE_ALARM sound): shows as heads-up with sound
    // This avoids double sound when locked (notification + MediaPlayer) while ensuring sound when unlocked.
    val isLocked = (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    val isBreak = body.startsWith("Break")
    val notifChannel = if (isLocked) FSI_CHANNEL_ID else if (isBreak) BREAK_CHANNEL_ID else WORK_CHANNEL_ID

    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val alarmNotif = NotificationCompat.Builder(this, notifChannel)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setFullScreenIntent(activityPi, true)
      .setOngoing(true)
      .setAutoCancel(false)
      .build()
    nm.notify(ALARM_NOTIF_ID, alarmNotif)
    nm.cancel(AlarmSoundModule.COUNTDOWN_NOTIF_ID)  // dismiss the running countdown

    // Block JS play() before the activity starts so there's no race-condition double sound
    AlarmSoundModule.alarmActivityShowing = true

    return START_NOT_STICKY
  }

  private fun isAppInForeground(): Boolean {
    val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    return am.runningAppProcesses?.any {
      it.processName == packageName &&
      it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    } ?: false
  }
}
