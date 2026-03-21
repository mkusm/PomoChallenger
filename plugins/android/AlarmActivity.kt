package PACKAGE_NAME

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

class AlarmActivity : Activity() {
  private var player: MediaPlayer? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Show over lock screen without dismissing it
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val body = intent.getStringExtra("body") ?: ""
    val isBreak = body.startsWith("Break")
    val dp = resources.displayMetrics.density

    // ── Root layout ──────────────────────────────────────────────────────────
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#121212"))
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
      )
      setPadding(
        (32 * dp).toInt(), (48 * dp).toInt(),
        (32 * dp).toInt(), (48 * dp).toInt()
      )
    }

    // ── Emoji icon ───────────────────────────────────────────────────────────
    root.addView(TextView(this).apply {
      text = if (isBreak) "\u2615" else "\uD83C\uDF45"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 64f)
      gravity = Gravity.CENTER
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
      ).also { it.bottomMargin = (24 * dp).toInt() }
    })

    // ── Title ────────────────────────────────────────────────────────────────
    root.addView(TextView(this).apply {
      text = if (isBreak) "Break over!" else "Focus session done!"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
      setTextColor(Color.WHITE)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
      )
    })

    setContentView(root)

    // skipSound is true when screen was unlocked at alarm time — the notification channel
    // already played the sound, so AlarmActivity should not play a second one.
    val skipSound = intent.getBooleanExtra("skipSound", false)
    if (skipSound) {
      // No sound to wait for — dismiss immediately
      dismissAlarm()
    } else {
      playAlarmSound(if (isBreak) "ding.wav" else "ding2.wav")
      // Fallback auto-dismiss after 5 s in case sound completion never fires
      Handler(Looper.getMainLooper()).postDelayed({ if (!isFinishing) dismissAlarm() }, 5_000)
    }
  }

  private fun dismissAlarm() {
    // Cancel the alarm notification so it doesn't linger in the shade
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .cancel(AlarmService.ALARM_NOTIF_ID)
    stopService(Intent(this, AlarmService::class.java))
    finish()
  }

  private fun playAlarmSound(fileName: String) {
    try {
      val resId = resources.getIdentifier(
        fileName.substringBeforeLast('.'), "raw", packageName
      )
      if (resId == 0) return
      player = MediaPlayer().apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
        setDataSource(this@AlarmActivity, Uri.parse("android.resource://$packageName/$resId"))
        prepare()
        start()
        setOnCompletionListener { release(); player = null; runOnUiThread { dismissAlarm() } }
      }
    } catch (_: Exception) {
      // Sound failed to load — dismiss immediately so UI doesn't get stuck
      dismissAlarm()
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    player?.release()
    player = null
    AlarmService.wakeLock?.let { if (it.isHeld) it.release() }
    AlarmService.wakeLock = null
    AlarmSoundModule.alarmActivityShowing = false
  }
}
