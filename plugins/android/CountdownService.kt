package PACKAGE_NAME

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
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat

class CountdownService : Service() {
  companion object {
    const val CHANNEL_ID = "pomo-countdown"
    const val PAUSE_REQUEST_CODE  = 2001
    const val RESUME_REQUEST_CODE = 2002

    @Volatile var instance: CountdownService? = null

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT >= 26) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
          NotificationChannel(CHANNEL_ID, "Timer countdown", NotificationManager.IMPORTANCE_LOW).also {
            it.setSound(null, null)
            it.enableVibration(false)
            it.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(it)
          }
        }
      }
    }

    // The countdown notification (custom progress-bar layout + play/pause button), shared by the
    // running service and AlarmSoundModule's idle "ready to start" poster. isPaused=true shows the
    // resume/play button (also used for the idle state); false shows the pause button.
    fun buildNotification(
      ctx: Context, label: String, timeText: String, progress: Int, isBreak: Boolean, isPaused: Boolean,
    ): android.app.Notification {
      ensureChannel(ctx)
      val res = ctx.resources
      val layoutName = if (isBreak) "notification_countdown_break" else "notification_countdown_work"
      val progressId = res.getIdentifier("cd_progress", "id", ctx.packageName)
      val views = RemoteViews(ctx.packageName, res.getIdentifier(layoutName, "layout", ctx.packageName))
      views.setProgressBar(progressId, 1000, progress, false)
      views.setFloat(progressId, "setScaleX", -1f)
      views.setTextViewText(res.getIdentifier("cd_text", "id", ctx.packageName), timeText)

      val action  = if (isPaused) "${ctx.packageName}.RESUME_TIMER" else "${ctx.packageName}.PAUSE_TIMER"
      val reqCode = if (isPaused) RESUME_REQUEST_CODE else PAUSE_REQUEST_CODE
      val icon    = if (isPaused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause
      val actionPi = PendingIntent.getBroadcast(
        ctx, reqCode, Intent(action).setPackage(ctx.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val buttonId = res.getIdentifier("cd_button", "id", ctx.packageName)
      views.setImageViewResource(buttonId, icon)
      views.setOnClickPendingIntent(buttonId, actionPi)

      val tapPi = PendingIntent.getActivity(
        ctx, AlarmSoundModule.COUNTDOWN_NOTIF_ID,
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return NotificationCompat.Builder(ctx, CHANNEL_ID)
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
    }
  }

  private var endMs: Long = 0
  private var totalMs: Long = 0
  private var label: String = ""
  private var isBreak: Boolean = false
  private var pausedRemainingMs: Long = 0
  // Tracked explicitly rather than inferred from pausedRemainingMs > 0, so pausing with
  // under a second left still renders as paused.
  private var isPaused: Boolean = false

  private val handler = Handler(Looper.getMainLooper())
  private val tickRunnable = object : Runnable {
    override fun run() {
      if (System.currentTimeMillis() >= endMs) return  // timer ended; JS will cancel
      updateNotification()
      handler.postDelayed(this, 1000)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensureChannel(this)
  }

  override fun onDestroy() {
    super.onDestroy()
    handler.removeCallbacks(tickRunnable)
    instance = null
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    endMs   = intent?.getLongExtra("endTimeMs", 0) ?: 0
    totalMs = intent?.getLongExtra("totalMs",   0) ?: 0
    label   = intent?.getStringExtra("label")   ?: ""
    isBreak = intent?.getBooleanExtra("isBreak", false) ?: false
    pausedRemainingMs = 0
    isPaused = false

    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(AlarmSoundModule.COUNTDOWN_NOTIF_ID, buildNotif(),
        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      // FGS type isn't enforced before Android 14; the manifest declaration covers those versions.
      startForeground(AlarmSoundModule.COUNTDOWN_NOTIF_ID, buildNotif())
    }
    handler.removeCallbacks(tickRunnable)
    handler.postDelayed(tickRunnable, 1000)
    return START_NOT_STICKY
  }

  fun pause(remainingMs: Long) {
    handler.removeCallbacks(tickRunnable)
    isPaused = true
    pausedRemainingMs = remainingMs
    updateNotification()
  }

  fun cancel() {
    handler.removeCallbacks(tickRunnable)
    stopForeground(true)
    stopSelf()
  }

  private fun buildNotif(): android.app.Notification {
    val remainingMs = if (isPaused) pausedRemainingMs
                      else (endMs - System.currentTimeMillis()).coerceAtLeast(0)
    val remainingSec = remainingMs / 1000L
    // Progress bar max is 1000; scale remaining/total into that range.
    val progress = if (totalMs > 0) ((remainingMs * 1000L) / totalMs).toInt() else 0
    val timeText = String.format("%d:%02d", remainingSec / 60, remainingSec % 60)
    return buildNotification(this, label, timeText, progress, isBreak, isPaused)
  }

  private fun updateNotification() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.notify(AlarmSoundModule.COUNTDOWN_NOTIF_ID, buildNotif())
  }
}
