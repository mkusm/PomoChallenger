package PACKAGE_NAME

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.util.Log
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class AlarmSoundModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "AlarmSound"

  init { instance = this }

  fun emitEvent(eventName: String) {
    try {
      if (!ctx.hasActiveReactInstance()) return
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit(eventName, null)
    } catch (e: Exception) { Log.w("Pomo", "emitEvent failed", e) }
  }

  private var player: MediaPlayer? = null

  companion object {
    private const val ALARM_REQUEST_CODE = 1001
    const val COUNTDOWN_NOTIF_ID = 9003
    // Set to true by AlarmService before it starts AlarmActivity so play() is skipped,
    // preventing a double sound when both JS and AlarmActivity fire at the same time.
    @Volatile var alarmActivityShowing = false
    @Volatile var instance: AlarmSoundModule? = null
  }

  // Play immediately on STREAM_ALARM (foreground use)
  @ReactMethod
  fun play(fileName: String) {
    if (alarmActivityShowing) return  // AlarmActivity is handling sound
    try {
      player?.release()
      val resId = ctx.resources.getIdentifier(
        fileName.substringBeforeLast('.'), "raw", ctx.packageName
      )
      if (resId == 0) return
      player = MediaPlayer().apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
        setDataSource(ctx, Uri.parse("android.resource://${ctx.packageName}/$resId"))
        prepare()
        start()
        setOnCompletionListener { release(); player = null }
      }
    } catch (e: Exception) { Log.w("Pomo", "play failed", e) }
  }

  // Schedule AlarmService via setAlarmClock() — uses getForegroundService() so the service
  // can start AlarmActivity even when the app is in the background (Android 10+ restriction bypass)
  @ReactMethod
  fun scheduleAlarm(triggerAtMs: Double, title: String, body: String, sound: String, isBreak: Boolean) {
    try {
      // Fresh schedule — clear the guard so a previously-leaked flag can't mute this alarm.
      alarmActivityShowing = false
      val intent = Intent(ctx, AlarmService::class.java).apply {
        putExtra("title", title)
        putExtra("body", body)
        putExtra("sound", sound)
        putExtra("isBreak", isBreak)
      }
      val pi = if (Build.VERSION.SDK_INT >= 26) {
        PendingIntent.getForegroundService(
          ctx, ALARM_REQUEST_CODE, intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      } else {
        PendingIntent.getService(
          ctx, ALARM_REQUEST_CODE, intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      }
      // Show intent: open the app when user taps alarm clock icon in status bar
      val showIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val showPi = PendingIntent.getActivity(
        ctx, ALARM_REQUEST_CODE + 1,
        showIntent ?: intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      am.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAtMs.toLong(), showPi), pi)
    } catch (e: Exception) { Log.w("Pomo", "scheduleAlarm failed", e) }
  }

  // Start CountdownService as a foreground service so the Handler keeps ticking
  // even when the app process is throttled in the background.
  @ReactMethod
  fun showCountdownNotification(endTimeMs: Double, totalDurationMs: Double, label: String, isBreak: Boolean) {
    try {
      val intent = Intent(ctx, CountdownService::class.java).apply {
        putExtra("endTimeMs",  endTimeMs.toLong())
        putExtra("totalMs",    totalDurationMs.toLong())
        putExtra("label",      label)
        putExtra("isBreak",    isBreak)
      }
      if (Build.VERSION.SDK_INT >= 26) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
    } catch (e: Exception) { Log.w("Pomo", "showCountdownNotification failed", e) }
  }

  @ReactMethod
  fun pauseCountdownNotification(remainingMs: Double) {
    try {
      CountdownService.instance?.pause(remainingMs.toLong())
    } catch (e: Exception) { Log.w("Pomo", "pauseCountdownNotification failed", e) }
  }

  @ReactMethod
  fun cancelCountdownNotification() {
    try {
      val svc = CountdownService.instance
      if (svc != null) {
        svc.cancel()
      } else {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(COUNTDOWN_NOTIF_ID)
      }
    } catch (e: Exception) { Log.w("Pomo", "cancelCountdownNotification failed", e) }
  }

  // Show a static "ready to start" notification when the timer is idle (not running).
  // Stops CountdownService first if it's running, then posts directly (no service needed
  // since the notification doesn't need periodic updates).
  @ReactMethod
  fun showIdleNotification(label: String, timeText: String, isBreak: Boolean) {
    try {
      CountdownService.instance?.cancel()  // stop countdown updates if still running
      CountdownService.ensureChannel(ctx)

      val layoutId = if (isBreak) {
        ctx.resources.getIdentifier("notification_countdown_break", "layout", ctx.packageName)
      } else {
        ctx.resources.getIdentifier("notification_countdown_work", "layout", ctx.packageName)
      }
      val progressId = ctx.resources.getIdentifier("cd_progress", "id", ctx.packageName)
      val textId     = ctx.resources.getIdentifier("cd_text",     "id", ctx.packageName)
      val buttonId   = ctx.resources.getIdentifier("cd_button",   "id", ctx.packageName)

      val views = RemoteViews(ctx.packageName, layoutId)
      views.setProgressBar(progressId, 1000, 1000, false)
      views.setFloat(progressId, "setScaleX", -1f)
      views.setTextViewText(textId, timeText)
      views.setImageViewResource(buttonId, android.R.drawable.ic_media_play)

      val resumeIntent = Intent("${ctx.packageName}.RESUME_TIMER").setPackage(ctx.packageName)
      val resumePi = PendingIntent.getBroadcast(
        ctx, CountdownService.RESUME_REQUEST_CODE, resumeIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      views.setOnClickPendingIntent(buttonId, resumePi)

      val tapPi = PendingIntent.getActivity(
        ctx, COUNTDOWN_NOTIF_ID,
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val notif = NotificationCompat.Builder(ctx, CountdownService.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(label)
        .setOngoing(true)
        .setSilent(true)
        .setOnlyAlertOnce(true)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(views)
        .setCustomBigContentView(views)
        .setContentIntent(tapPi)
        .build()

      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(COUNTDOWN_NOTIF_ID, notif)
    } catch (e: Exception) { Log.w("Pomo", "showIdleNotification failed", e) }
  }

  @ReactMethod
  fun cancelAlarm() {
    try {
      // Clearing a pending/fired alarm also clears the double-sound guard.
      alarmActivityShowing = false
      val intent = Intent(ctx, AlarmService::class.java)
      val pi = if (Build.VERSION.SDK_INT >= 26) {
        PendingIntent.getForegroundService(
          ctx, ALARM_REQUEST_CODE, intent,
          PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
      } else {
        PendingIntent.getService(
          ctx, ALARM_REQUEST_CODE, intent,
          PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
      }
      if (pi != null) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pi)
        pi.cancel()
      }
    } catch (e: Exception) { Log.w("Pomo", "cancelAlarm failed", e) }
  }
}
