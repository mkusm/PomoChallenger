package PACKAGE_NAME

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
        Uri.parse("package:${ctx.packageName}")
      )
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
    }
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    ctx.startActivity(intent)
  }
}
