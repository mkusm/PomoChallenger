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

const KOTLIN_FILES = [
  'AlarmService.kt',
  'AlarmActivity.kt',
  'AlarmSoundModule.kt',
  'FullScreenIntentModule.kt',
  'FullScreenIntentPackage.kt',
];

function writeNativeModuleFiles(platformProjectRoot, packageName) {
  const packagePath = packageName.split('.').join(path.sep);
  const destDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'java', packagePath);
  fs.mkdirSync(destDir, { recursive: true });

  const srcDir = path.join(__dirname, 'android');
  for (const fileName of KOTLIN_FILES) {
    const contents = fs.readFileSync(path.join(srcDir, fileName), 'utf8')
      .replace('package PACKAGE_NAME', `package ${packageName}`);
    fs.writeFileSync(path.join(destDir, fileName), contents);
  }
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
