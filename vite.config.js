import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'/raji-fitness-center/',plugins:[react()],build:{rollupOptions:{external:id=>id.startsWith('https://')}}});
