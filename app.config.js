const appJson = require('./app.json');

module.exports = ({ config }) => {
  const androidMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;
  const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;
  const plugins = [...(appJson.expo.plugins ?? [])];

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
