const { withDangerousMod, withGradleProperties, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── 1. Patch ExpoNotificationBuilder ────────────────────────────────────────

const BUILDER_REL_PATH = [
  'node_modules', 'expo-notifications', 'android', 'src', 'main', 'java',
  'expo', 'modules', 'notifications', 'notifications', 'presentation', 'builders',
  'ExpoNotificationBuilder.kt',
].join(path.sep);

function patchNotificationBuilder(projectRoot) {
  const filePath = path.join(projectRoot, BUILDER_REL_PATH);
  let contents = fs.readFileSync(filePath, 'utf8');
  if (contents.includes('CATEGORY_ALARM')) return; // already patched

  contents = contents.replace(
    '    return builder.build()',
    `    builder.setCategory(android.app.Notification.CATEGORY_ALARM)
    return builder.build()`,
  );

  fs.writeFileSync(filePath, contents);
}

// ─── 2. Native files ──────────────────────────────────────────────────────────

function writeNativeModuleFiles(platformProjectRoot, packageName) {
  const packagePath = packageName.split('.').join(path.sep);
  const dir = path.join(platformProjectRoot, 'app', 'src', 'main', 'java', packagePath);
  fs.mkdirSync(dir, { recursive: true });

  // AlarmService: ForegroundService started by AlarmManager.
  // Strategy:
  //   • If the app is already in the foreground, JS handles the alarm — stop immediately (prevents double sound).
  //   • If the app is in the background:
  //       1. Acquire WakeLock (ACQUIRE_CAUSES_WAKEUP) to turn screen on.
  //       2. startForeground() with a silent notification (required to keep service alive).
  //       3. Post a MAX-importance alarm notification with setFullScreenIntent() on the alarm channel.
  //          This is the canonical Android path: notification delivery itself launches the FSI activity.
  //       4. Also try startActivity() directly as a fallback for Android versions where it works.
  fs.writeFileSync(path.join(dir, 'AlarmService.kt'), `package ${packageName}

import android.app.ActivityManager
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
    private const val SVC_CHANNEL_ID  = "pomo-alarm-service"  // IMPORTANCE_LOW, silent — for startForeground
    private const val FSI_CHANNEL_ID  = "pomo-alarm-fsi"      // IMPORTANCE_HIGH, silent — FSI requires high importance
    private const val SVC_NOTIF_ID    = 9001
    const val ALARM_NOTIF_ID          = 9002
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

    // Post a MAX-priority notification with full-screen intent on the SILENT service channel.
    // Using the silent channel avoids a double sound: AlarmActivity's MediaPlayer is the sole
    // audio source, playing through alarm volume. The full-screen intent mechanism delivers
    // the notification as a full-screen activity when the device is locked (Android 10+ canonical
    // alarm pattern). If FSI is unavailable it falls back to a heads-up notification.
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val alarmNotif = NotificationCompat.Builder(this, FSI_CHANNEL_ID)
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
`);

  // AlarmActivity: full-screen UI shown over lock screen when timer ends
  fs.writeFileSync(path.join(dir, 'AlarmActivity.kt'), `package ${packageName}

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
    val sound = if (isBreak) "ding.wav" else "ding2.wav"
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
      ).also { it.bottomMargin = (12 * dp).toInt() }
    })

    // ── Subtitle ─────────────────────────────────────────────────────────────
    root.addView(TextView(this).apply {
      text = if (isBreak) "Time to get back to work." else "Take a well-earned break."
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setTextColor(Color.parseColor("#9E9E9E"))
      gravity = Gravity.CENTER
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
      ).also { it.bottomMargin = (56 * dp).toInt() }
    })

    // ── Dismiss button (rounded pill) ────────────────────────────────────────
    root.addView(TextView(this).apply {
      text = "Dismiss"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setTextColor(Color.WHITE)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(
        (40 * dp).toInt(), (16 * dp).toInt(),
        (40 * dp).toInt(), (16 * dp).toInt()
      )
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#E53935"))
        cornerRadius = 28 * dp
      }
      layoutParams = LinearLayout.LayoutParams(
        (220 * dp).toInt(), LinearLayout.LayoutParams.WRAP_CONTENT
      ).also { it.gravity = Gravity.CENTER_HORIZONTAL }
      setOnClickListener { dismissAlarm() }
    })

    setContentView(root)
    playAlarmSound(sound)

    // Auto-dismiss after 60 s
    Handler(Looper.getMainLooper()).postDelayed({ if (!isFinishing) dismissAlarm() }, 60_000)
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
        setDataSource(this@AlarmActivity, Uri.parse("android.resource://\$packageName/\$resId"))
        prepare()
        start()
        setOnCompletionListener { release(); player = null }
      }
    } catch (_: Exception) {}
  }

  override fun onDestroy() {
    super.onDestroy()
    player?.release()
    player = null
    AlarmService.wakeLock?.let { if (it.isHeld) it.release() }
    AlarmService.wakeLock = null
  }
}
`);

  fs.writeFileSync(path.join(dir, 'FullScreenIntentModule.kt'), `package ${packageName}

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class FullScreenIntentModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "FullScreenIntent"

  @ReactMethod
  fun isGranted(promise: Promise) {
    if (Build.VERSION.SDK_INT >= 34) {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      promise.resolve(nm.canUseFullScreenIntent())
    } else {
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun openSettings() {
    val intent = if (Build.VERSION.SDK_INT >= 34) {
      Intent(
        Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
        Uri.parse("package:\${ctx.packageName}")
      )
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:\${ctx.packageName}"))
    }
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    ctx.startActivity(intent)
  }
}
`);

  fs.writeFileSync(path.join(dir, 'AlarmSoundModule.kt'), `package ${packageName}

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
  }

  // Play immediately on STREAM_ALARM (foreground use)
  @ReactMethod
  fun play(fileName: String) {
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
        setDataSource(ctx, Uri.parse("android.resource://\${ctx.packageName}/\$resId"))
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
      val intent = Intent(ctx, Class.forName("\${ctx.packageName}.AlarmService")).apply {
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
      val intent = Intent(ctx, Class.forName("\${ctx.packageName}.AlarmService"))
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
`);

  fs.writeFileSync(path.join(dir, 'FullScreenIntentPackage.kt'), `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class FullScreenIntentPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
    listOf(FullScreenIntentModule(ctx), AlarmSoundModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`);
}

// ─── 3. Register package in MainApplication ───────────────────────────────────

function patchMainApplication(platformProjectRoot, packageName) {
  const packagePath = packageName.split('.').join(path.sep);
  const mainAppPath = path.join(
    platformProjectRoot, 'app', 'src', 'main', 'java', packagePath, 'MainApplication.kt',
  );
  let contents = fs.readFileSync(mainAppPath, 'utf8');
  if (contents.includes('FullScreenIntentPackage')) return; // already patched

  // RN 0.81 uses PackageList(this).packages.apply { // add(MyReactNativePackage()) }
  contents = contents.replace(
    '// add(MyReactNativePackage())',
    '// add(MyReactNativePackage())\n              add(FullScreenIntentPackage())',
  );
  fs.writeFileSync(mainAppPath, contents);
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = function withFullScreenIntent(config) {
  // Force Kotlin to compile in-process (avoids Gradle↔Kotlin daemon RPC deadlock in WSL2)
  // and increase JVM memory limits to handle the extra metaspace used by in-process compilation
  config = withGradleProperties(config, (config) => {
    const overrides = {
      'kotlin.compiler.execution.strategy': 'in-process',
      'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=2g -XX:+HeapDumpOnOutOfMemoryError',
    };
    for (const [key, value] of Object.entries(overrides)) {
      config.modResults = config.modResults.filter((item) => item.key !== key);
      config.modResults.push({ type: 'property', key, value });
    }
    return config;
  });

  // Register AlarmActivity + AlarmService; set lock-screen flags on MainActivity
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];

    const mainActivity = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (mainActivity) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
    }

    if (!app?.activity?.find((a) => a.$['android:name'] === '.AlarmActivity')) {
      app.activity.push({
        $: {
          'android:name': '.AlarmActivity',
          'android:showWhenLocked': 'true',
          'android:turnScreenOn': 'true',
          'android:exported': 'false',
          'android:theme': '@android:style/Theme.Black.NoTitleBar.Fullscreen',
        },
      });
    }

    if (!app?.service?.find?.((s) => s.$['android:name'] === '.AlarmService')) {
      app.service = app.service ?? [];
      app.service.push({
        $: {
          'android:name': '.AlarmService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'mediaPlayback',
        },
      });
    }

    return config;
  });

  return withDangerousMod(config, [
    'android',
    (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const packageName = config.android?.package ?? 'com.example.app';

      patchNotificationBuilder(projectRoot);
      writeNativeModuleFiles(platformProjectRoot, packageName);
      patchMainApplication(platformProjectRoot, packageName);

      return config;
    },
  ]);
};
