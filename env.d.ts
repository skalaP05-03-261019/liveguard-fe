/// <reference types="vite/client" />
declare module '*.vue' { import type { DefineComponent } from 'vue'; const component: DefineComponent<{}, {}, any>; export default component }
interface ImportMetaEnv {
  readonly VITE_USE_API?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_STREAM_SRC?: string;
  readonly VITE_STREAM_POSTER?: string;
  readonly VITE_DEMO_WIFI_NAME?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
