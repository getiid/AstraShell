import { createApp } from 'vue'
import './style.css'
import './theme-light-gray.css'
import './styles/app-shell.css'
import App from './App.vue'

// Initialize Tauri bridge (replaces Electron preload)
import './lib/tauri-bridge'

createApp(App).mount('#app')
