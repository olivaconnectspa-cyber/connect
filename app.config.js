const appJson = require('./app.json');

module.exports = ({ config }) => {
  const androidMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;
  const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;
  const plugins = [...(appJson.expo.plugins ?? [])];

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
