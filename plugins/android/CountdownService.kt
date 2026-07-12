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
  }

  private var endMs: Long = 0
  private var totalMs: Long = 0
  private var label: String = ""
  private var isBreak: Boolean = false
  private var pausedRemainingMs: Long = 0
  // Tracked explicitly rather than inferred from pausedRemainingMs > 0, so pausing with
  // under a second left still renders as paused.
  private var isPaused: Boolean = false

  private var layoutWorkId: Int = 0
  private var layoutBreakId: Int = 0
  private var progressId: Int = 0
  private var textId: Int = 0
  private var buttonId: Int = 0

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
    layoutWorkId  = resources.getIdentifier("notification_countdown_work",  "layout", packageName)
    layoutBreakId = resources.getIdentifier("notification_countdown_break", "layout", packageName)
    progressId    = resources.getIdentifier("cd_progress", "id", packageName)
    textId        = resources.getIdentifier("cd_text",     "id", packageName)
    buttonId      = resources.getIdentifier("cd_button",   "id", packageName)
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

    val layoutId = if (isBreak) layoutBreakId else layoutWorkId
    val views = RemoteViews(packageName, layoutId)
    views.setProgressBar(progressId, 1000, progress, false)
    views.setFloat(progressId, "setScaleX", -1f)
    views.setTextViewText(textId, timeText)

    val actionAction = if (isPaused) "$packageName.RESUME_TIMER" else "$packageName.PAUSE_TIMER"
    val actionCode   = if (isPaused) RESUME_REQUEST_CODE else PAUSE_REQUEST_CODE
    val actionIcon   = if (isPaused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause
    val actionIntent = Intent(actionAction).setPackage(packageName)
    val actionPi = PendingIntent.getBroadcast(
      this, actionCode, actionIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    views.setImageViewResource(buttonId, actionIcon)
    views.setOnClickPendingIntent(buttonId, actionPi)

    val tapPi = PendingIntent.getActivity(
      this, AlarmSoundModule.COUNTDOWN_NOTIF_ID,
      packageManager.getLaunchIntentForPackage(packageName) ?: Intent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
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

  private fun updateNotification() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.notify(AlarmSoundModule.COUNTDOWN_NOTIF_ID, buildNotif())
  }
}
