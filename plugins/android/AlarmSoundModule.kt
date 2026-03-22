package PACKAGE_NAME

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
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
    } catch (_: Exception) {}
  }

  private var player: MediaPlayer? = null

  // Countdown notification state
  private var cdEndMs: Long = 0
  private var cdTotalMs: Long = 0
  private var cdLabel: String = ""
  private var cdIsBreak: Boolean = false
  private var cdTapPi: PendingIntent? = null
  private var cdHandler: Handler? = null
  private var cdRunnable: Runnable? = null
  private var cdIsActive: Boolean = false
  private var cdPausedRemainingMs: Long = 0  // 0 means running, >0 means paused
  // Cached resource IDs — populated in showCountdownNotification(), valid for the life of a session
  private var cdLayoutWorkId: Int = 0
  private var cdLayoutBreakId: Int = 0
  private var cdProgressId: Int = 0
  private var cdTextId: Int = 0
  private var cdButtonId: Int = 0

  companion object {
    private const val ALARM_REQUEST_CODE = 1001
    private const val COUNTDOWN_CHANNEL_ID = "pomo-countdown"
    const val COUNTDOWN_NOTIF_ID = 9003
    private const val PAUSE_REQUEST_CODE  = 2001
    private const val RESUME_REQUEST_CODE = 2002
    private const val ACTION_PAUSE  = ".PAUSE_TIMER"
    private const val ACTION_RESUME = ".RESUME_TIMER"
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
    } catch (_: Exception) {}
  }

  // Schedule AlarmService via setAlarmClock() — uses getForegroundService() so the service
  // can start AlarmActivity even when the app is in the background (Android 10+ restriction bypass)
  @ReactMethod
  fun scheduleAlarm(triggerAtMs: Double, title: String, body: String, sound: String) {
    try {
      val intent = Intent(ctx, Class.forName("${ctx.packageName}.AlarmService")).apply {
        putExtra("title", title)
        putExtra("body", body)
        putExtra("sound", sound)
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
    } catch (_: Exception) {}
  }

  // Build the countdown notification with a custom fat progress bar, time text, and Pause/Resume button.
  private fun buildCountdownNotif(): android.app.Notification {
    val isPaused = cdPausedRemainingMs > 0
    val remainingSec = if (isPaused) {
      cdPausedRemainingMs / 1000L
    } else {
      ((cdEndMs - System.currentTimeMillis()) / 1000L).coerceAtLeast(0)
    }
    val progress = if (cdTotalMs > 0) ((remainingSec * 1000) / (cdTotalMs / 1000)).toInt() else 0
    val timeText = String.format("%d:%02d", remainingSec / 60, remainingSec % 60)

    val layoutId = if (cdIsBreak) cdLayoutBreakId else cdLayoutWorkId
    val views = RemoteViews(ctx.packageName, layoutId)
    views.setProgressBar(cdProgressId, 1000, progress, false)
    views.setFloat(cdProgressId, "setScaleX", -1f)  // mirror so fill drains left-to-right
    views.setTextViewText(cdTextId, timeText)

    val actionAction = if (isPaused) "${ctx.packageName}$ACTION_RESUME" else "${ctx.packageName}$ACTION_PAUSE"
    val actionCode   = if (isPaused) RESUME_REQUEST_CODE else PAUSE_REQUEST_CODE
    val actionIcon   = if (isPaused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause
    val actionIntent = Intent(actionAction).setPackage(ctx.packageName)
    val actionPi = PendingIntent.getBroadcast(
      ctx, actionCode, actionIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    views.setImageViewResource(cdButtonId, actionIcon)
    views.setOnClickPendingIntent(cdButtonId, actionPi)

    val builder = NotificationCompat.Builder(ctx, COUNTDOWN_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(cdLabel)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(views)
      .setCustomBigContentView(views)
      .setContentIntent(cdTapPi)
    return builder.build()
  }

  // Show an ongoing notification with a native countdown chronometer and live progress bar.
  // A Handler ticks every second to update the progress — no JS polling needed.
  @ReactMethod
  fun showCountdownNotification(endTimeMs: Double, totalDurationMs: Double, label: String, isBreak: Boolean) {
    try {
      stopCountdownHandler()
      cdEndMs = endTimeMs.toLong()
      cdTotalMs = totalDurationMs.toLong()
      cdLabel = label
      cdIsBreak = isBreak
      cdPausedRemainingMs = 0
      cdIsActive = true
      // Cache resource IDs once per session — getIdentifier() is expensive to call every second
      cdLayoutWorkId  = ctx.resources.getIdentifier("notification_countdown_work",  "layout", ctx.packageName)
      cdLayoutBreakId = ctx.resources.getIdentifier("notification_countdown_break", "layout", ctx.packageName)
      cdProgressId    = ctx.resources.getIdentifier("cd_progress", "id", ctx.packageName)
      cdTextId        = ctx.resources.getIdentifier("cd_text",     "id", ctx.packageName)
      cdButtonId      = ctx.resources.getIdentifier("cd_button",   "id", ctx.packageName)

      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(COUNTDOWN_CHANNEL_ID) == null) {
        NotificationChannel(COUNTDOWN_CHANNEL_ID, "Timer countdown", NotificationManager.IMPORTANCE_LOW).also {
          it.setSound(null, null)
          it.enableVibration(false)
          it.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
          nm.createNotificationChannel(it)
        }
      }
      cdTapPi = PendingIntent.getActivity(
        ctx, COUNTDOWN_NOTIF_ID,
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      nm.notify(COUNTDOWN_NOTIF_ID, buildCountdownNotif())

      val handler = Handler(Looper.getMainLooper())
      val runnable = object : Runnable {
        override fun run() {
          if (System.currentTimeMillis() >= cdEndMs) return  // timer ended; JS will cancel
          nm.notify(COUNTDOWN_NOTIF_ID, buildCountdownNotif())
          handler.postDelayed(this, 1000)
        }
      }
      cdHandler = handler
      cdRunnable = runnable
      handler.postDelayed(runnable, 1000)
    } catch (_: Exception) {}
  }

  // Freeze the countdown notification in paused state with a Resume button.
  @ReactMethod
  fun pauseCountdownNotification(remainingMs: Double) {
    if (!cdIsActive) return
    try {
      stopCountdownHandler()
      cdPausedRemainingMs = remainingMs.toLong()
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(COUNTDOWN_NOTIF_ID, buildCountdownNotif())
    } catch (_: Exception) {}
  }

  private fun stopCountdownHandler() {
    cdRunnable?.let { cdHandler?.removeCallbacks(it) }
    cdHandler = null
    cdRunnable = null
  }

  @ReactMethod
  fun cancelCountdownNotification() {
    try {
      stopCountdownHandler()
      cdIsActive = false
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.cancel(COUNTDOWN_NOTIF_ID)
    } catch (_: Exception) {}
  }

  // Show a static "ready to start" notification when the timer is idle (not running).
  // Uses the same notification ID as the countdown so they never stack.
  @ReactMethod
  fun showIdleNotification(label: String, timeText: String, isBreak: Boolean) {
    try {
      stopCountdownHandler()
      cdIsActive = false
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(COUNTDOWN_CHANNEL_ID) == null) {
        NotificationChannel(COUNTDOWN_CHANNEL_ID, "Timer countdown", NotificationManager.IMPORTANCE_LOW).also {
          it.setSound(null, null)
          it.enableVibration(false)
          it.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
          nm.createNotificationChannel(it)
        }
      }
      val tapPi = PendingIntent.getActivity(
        ctx, COUNTDOWN_NOTIF_ID,
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
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
      val resumeIntent = Intent("${ctx.packageName}$ACTION_RESUME").setPackage(ctx.packageName)
      val resumePi = PendingIntent.getBroadcast(
        ctx, RESUME_REQUEST_CODE, resumeIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      views.setOnClickPendingIntent(buttonId, resumePi)
      val notif = NotificationCompat.Builder(ctx, COUNTDOWN_CHANNEL_ID)
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
      nm.notify(COUNTDOWN_NOTIF_ID, notif)
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun cancelAlarm() {
    try {
      val intent = Intent(ctx, Class.forName("${ctx.packageName}.AlarmService"))
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
    } catch (_: Exception) {}
  }
}
