package PACKAGE_NAME

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PomoBroadcastReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val event = when (intent.action) {
      "${context.packageName}.PAUSE_TIMER"  -> "POMO_PAUSE"
      "${context.packageName}.RESUME_TIMER" -> "POMO_RESUME"
      else -> return
    }
    AlarmSoundModule.instance?.emitEvent(event)
  }
}
