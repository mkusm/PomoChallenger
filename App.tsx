import React, { useEffect } from 'react';
import { Alert, AppState, NativeModules, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import AppNavigator from './src/navigation/AppNavigator';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const CHANNEL_WORK  = 'pomo-work-4';
export const CHANNEL_BREAK = 'pomo-break-4';

// true after the alert has been shown; reset only after OS propagation delay when returning from settings
let fullScreenIntentPrompted = false;

async function checkFullScreenIntent(delay = 0) {
  if (Platform.OS !== 'android' || fullScreenIntentPrompted) return;
  const { FullScreenIntent } = NativeModules;
  if (!FullScreenIntent) return;
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
  const granted: boolean = await FullScreenIntent.isGranted();
  if (!granted) {
    fullScreenIntentPrompted = true;
    Alert.alert(
      'Allow full-screen alerts',
      'To wake the screen when your timer ends, grant Pomo permission to show full-screen notifications.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => {
            fullScreenIntentPrompted = false;
            FullScreenIntent.openSettings();
          },
        },
      ],
    );
  }
}

async function setup() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    console.warn('Notification permission not granted');
  }

  if (Platform.OS === 'android') {
    // audioAttributes usage=4 (ALARM) makes Android route sound through alarm volume stream
    const alarmAudioAttributes = {
      usage: 4,        // AndroidAudioUsage.ALARM
      contentType: 4,  // AndroidAudioContentType.SONIFICATION
      flags: { enforced: true, requestHardwareAV: false },
    };
    await Notifications.setNotificationChannelAsync(CHANNEL_WORK, {
      name: 'Work session end',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'ding2.wav',
      vibrationPattern: [0, 300],
      lightColor: '#E53935',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      audioAttributes: alarmAudioAttributes,
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_BREAK, {
      name: 'Break end',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'ding.wav',
      vibrationPattern: [0, 300],
      lightColor: '#43A047',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      audioAttributes: alarmAudioAttributes,
    });
  }
}

export default function App() {
  useEffect(() => {
    setup();
    checkFullScreenIntent();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkFullScreenIntent(500); // delay: OS propagates FSI permission asynchronously
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
