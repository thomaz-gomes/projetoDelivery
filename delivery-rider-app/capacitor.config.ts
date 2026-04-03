import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.coredelivery.rider',
  appName: 'Core Delivery Entregador',
  // Use live server — frontend updates reflect instantly without Play Store update
  server: {
    url: 'https://app.deliverywl.com.br',
    cleartext: false,
    // Allow navigation to the API domain for OAuth callbacks etc.
    allowNavigation: ['app.deliverywl.com.br', 'api.deliverywl.com.br'],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#198754',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#198754',
    },
  },
  android: {
    // Allow mixed content for dev; production uses HTTPS only
    allowMixedContent: false,
    // Start directly on rider orders
    startPath: '/rider/orders',
  },
};

export default config;
