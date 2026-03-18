package PACKAGE_NAME

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AlarmSoundModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "AlarmSound"

  private var player: MediaPlayer? = null

  companion object {
    private const val ALARM_REQUEST_CODE = 1001
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
