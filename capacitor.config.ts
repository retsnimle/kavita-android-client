import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.retsnimle.kavitareader',
  appName: 'Reader for Kavita',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
