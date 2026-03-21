package PACKAGE_NAME

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class FullScreenIntentPackage : ReactPackage {
  @Deprecated("Deprecated in ReactPackage", replaceWith = ReplaceWith(""))
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(FullScreenIntentModule(reactContext), AlarmSoundModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
