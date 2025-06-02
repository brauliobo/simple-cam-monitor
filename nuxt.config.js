// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },
  
  runtimeConfig: {
    public: {
      rtmpPort: process.env.NUXT_PUBLIC_RTMP_PORT || '1934',
      rtmpAppName: process.env.NUXT_PUBLIC_RTMP_APP_NAME || 'live',
    }
  },
  
  nitro: {
    experimental: {
      websocket: true 
    }
  }
}); 