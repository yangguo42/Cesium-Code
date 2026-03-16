import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './assets/main.css'
import App from './App.vue'
import VxeUITable from 'vxe-table'
import 'vxe-table/lib/style.css'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { zhCn } from 'element-plus/es/locales.mjs'

const app = createApp(App)
app.use(ElementPlus, {
    locale: zhCn,
    size: 'small',
})
app.use(VxeUITable)
app.use(createPinia())
app.mount('#app')
