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

class AlarmSoundModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "AlarmSound"

  private var player: MediaPlayer? = null

  // Countdown notification state
  private var cdEndMs: Long = 0
  private var cdTotalMs: Long = 0
  private var cdLabel: String = ""
  private var cdIsBreak: Boolean = false
  private var cdTapPi: PendingIntent? = null
  private var cdHandler: Handler? = null
  private var cdRunnable: Runnable? = null

  companion object {
    private const val ALARM_REQUEST_CODE = 1001
    private const val COUNTDOWN_CHANNEL_ID = "pomo-countdown"
    const val COUNTDOWN_NOTIF_ID = 9003
    // Set to true by AlarmService before it starts AlarmActivity so play() is skipped,
    // preventing a double sound when both JS and AlarmActivity fire at the same time.
    @Volatile var alarmActivityShowing = false
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

  // Build the countdown notification with a custom fat progress bar and time text.
  private fun buildCountdownNotif(): android.app.Notification {
    val now = System.currentTimeMillis()
    val startMs = cdEndMs - cdTotalMs
    val elapsedSec = ((now - startMs) / 1000L).coerceIn(0, cdTotalMs / 1000)
    val remainingSec = ((cdEndMs - now) / 1000L).coerceAtLeast(0)
    val progress = if (cdTotalMs > 0) ((remainingSec * 1000) / (cdTotalMs / 1000)).toInt() else 0
    val timeText = String.format("%d:%02d", remainingSec / 60, remainingSec % 60)

    val layoutName = if (cdIsBreak) "notification_countdown_break" else "notification_countdown_work"
    val layoutId = ctx.resources.getIdentifier(layoutName, "layout", ctx.packageName)
    val progressId = ctx.resources.getIdentifier("cd_progress", "id", ctx.packageName)
    val textId = ctx.resources.getIdentifier("cd_text", "id", ctx.packageName)

    val views = RemoteViews(ctx.packageName, layoutId)
    views.setProgressBar(progressId, 1000, progress, false)
    views.setFloat(progressId, "setScaleX", -1f)  // mirror so fill drains left-to-right
    views.setTextViewText(textId, timeText)

    val builder = NotificationCompat.Builder(ctx, COUNTDOWN_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(cdLabel)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
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

  private fun stopCountdownHandler() {
    cdRunnable?.let { cdHandler?.removeCallbacks(it) }
    cdHandler = null
    cdRunnable = null
  }

  @ReactMethod
  fun cancelCountdownNotification() {
    try {
      stopCountdownHandler()
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.cancel(COUNTDOWN_NOTIF_ID)
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
