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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
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
    // Must call startForeground() before any early return on Android 8+ — a getForegroundService()
    // PendingIntent requires startForeground() within 5 s or the system throws an exception.
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(SVC_CHANNEL_ID) == null) {
        NotificationChannel(SVC_CHANNEL_ID, "Alarm Service", NotificationManager.IMPORTANCE_LOW).also {
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
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(SVC_NOTIF_ID, silentNotif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      // FGS type isn't enforced before Android 14; the manifest declaration covers those versions.
      startForeground(SVC_NOTIF_ID, silentNotif)
    }

    val title = intent?.getStringExtra("title") ?: "Pomodoro"
    val body  = intent?.getStringExtra("body")  ?: ""
    // Session type is passed explicitly (see usePomodoro) — never sniffed from the body text.
    val isBreak = intent?.getBooleanExtra("isBreak", false) ?: false
    val sound = intent?.getStringExtra("sound") ?: if (isBreak) "ding.wav" else "ding2.wav"

    // AlarmService is the single end-of-session sound authority on Android; JS never plays (see
    // usePomodoro). This removes the JS-vs-native double-sound race: the countdown foreground-
    // service keeps the JS timer ticking while locked, and JS can't reliably tell it's backgrounded
    // because MainActivity is showWhenLocked (the wakelock brings it "active" over the keyguard).
    // If the app is in the foreground, play the sound in-process (JS shows the break UI but stays
    // silent) and stop — no full-screen activity or notification needed while the app is open.
    if (isAppInForeground()) {
      AlarmSoundModule.alarmActivityShowing = false
      AlarmSoundModule.instance?.play(sound)
      stopForeground(true)
      stopSelf()
      return START_NOT_STICKY
    }

    // Backgrounded/locked: AlarmActivity (locked) or the notification channel (unlocked) plays.
    AlarmSoundModule.alarmActivityShowing = true

    // Acquire WakeLock with ACQUIRE_CAUSES_WAKEUP so the screen turns on
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock?.let { if (it.isHeld) it.release() }
    @Suppress("DEPRECATION")
    wakeLock = pm.newWakeLock(
      PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
      "pomo:alarmwakelock"
    ).also { it.acquire(10 * 60 * 1000L) }

    // Create remaining notification channels if needed
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
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

    // Choose notification channel based on keyguard state:
    //   Locked   → FSI_CHANNEL_ID (silent, IMPORTANCE_HIGH): FSI delivers AlarmActivity, which plays sound
    //   Unlocked → alarm channel (IMPORTANCE_MAX, USAGE_ALARM sound): shows as heads-up with sound
    // This avoids double sound when locked (notification + MediaPlayer) while ensuring sound when unlocked.
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val isLocked = (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    // On Android 14+ the full-screen intent needs a runtime grant. If it's missing, the FSI
    // never fires and AlarmActivity never plays the sound — so only take the (silent) FSI path
    // when we can actually use it, otherwise fall back to the sounding heads-up channel.
    val canFsi = if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true
    val useFsiPath = isLocked && canFsi

    // PendingIntent that opens AlarmActivity when the user taps the notification.
    // Only the FSI path expects AlarmActivity to play sound; every other path lets the
    // notification channel sound, so tell the activity to skip its own MediaPlayer.
    val activityPi = PendingIntent.getActivity(
      this, 0,
      Intent(this, AlarmActivity::class.java).apply {
        setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        putExtra("title", title)
        putExtra("body",  body)
        putExtra("isBreak", isBreak)
        putExtra("sound", sound)
        putExtra("skipSound", !useFsiPath)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notifChannel = if (useFsiPath) FSI_CHANNEL_ID else if (isBreak) BREAK_CHANNEL_ID else WORK_CHANNEL_ID

    val alarmNotif = NotificationCompat.Builder(this, notifChannel)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setFullScreenIntent(activityPi, true)
      // On the FSI path the activity dismisses the notification; otherwise let the user
      // swipe it away, since nothing else will remove it.
      .setOngoing(useFsiPath)
      .setAutoCancel(!useFsiPath)
      .build()
    nm.notify(ALARM_NOTIF_ID, alarmNotif)
    // Stop CountdownService (foreground service — nm.cancel won't remove its notification)
    CountdownService.instance?.cancel()
      ?: nm.cancel(AlarmSoundModule.COUNTDOWN_NOTIF_ID)

    // On the FSI path AlarmActivity plays the sound and resets alarmActivityShowing in onDestroy.
    if (!useFsiPath) {
      // No full-screen activity will run — the notification channel plays the sound. Release the
      // wakelock and stop this foreground service shortly after the screen has woken (the alarm
      // notification, a separate id, stays in the shade), and reset the JS-play guard once the JS
      // timer has passed its own play point so future foreground sounds aren't blocked.
      Handler(Looper.getMainLooper()).postDelayed({
        try {
          wakeLock?.let { if (it.isHeld) it.release() }
          wakeLock = null
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
          AlarmSoundModule.alarmActivityShowing = false
        } catch (e: Exception) {
          Log.w("Pomo", "AlarmService cleanup failed", e)
        }
      }, 3000)
    }

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
