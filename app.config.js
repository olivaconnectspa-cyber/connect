const appJson = require('./app.json');

module.exports = ({ config }) => {
  const androidMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;
  const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;
  const plugins = [...(appJson.expo.plugins ?? [])];

  // SDK 58 requires these installed Expo modules to be declared in app config.
  for (const plugin of ['expo-font', 'expo-image', 'expo-status-bar', 'expo-web-browser']) {
    if (!plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === plugin)) {
      plugins.push(plugin);
    }
  }

  plugins.push([
    'expo-image-picker',
    {
      photosPermission: 'Connect necesita acceso a tus fotos para compartir información de domicilios.',
      cameraPermission: 'Connect necesita la cámara para fotografiar accesos y estacionamientos.',
      microphonePermission: false,
    },
  ]);

  if (androidMapsKey || iosMapsKey) {
    plugins.push([
      'react-native-maps',
      {
        ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
        ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}),
      },
    ]);
  }

  return {
    ...config,
    ...appJson.expo,
    plugins,
  };
};
