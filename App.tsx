import React, { useEffect } from 'react';
import { Platform } from 'react-native';
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

export const CHANNEL_WORK  = 'pomo-work-2';
export const CHANNEL_BREAK = 'pomo-break-2';

async function setup() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    console.warn('Notification permission not granted');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_WORK, {
      name: 'Work session end',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'ding2.wav',
      vibrationPattern: [0, 300],
      lightColor: '#E53935',
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_BREAK, {
      name: 'Break end',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'ding.wav',
      vibrationPattern: [0, 300],
      lightColor: '#43A047',
    });
  }
}

export default function App() {
  useEffect(() => {
    setup();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
