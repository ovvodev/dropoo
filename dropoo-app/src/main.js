import './process-polyfill'
import { createApp } from 'vue'
import { VueUmamiPlugin } from '@jaseeey/vue-umami-plugin';

import App from './App.vue'
import '../src/assets/main.css'

const app = createApp(App);

app.use(VueUmamiPlugin, {
    websiteID: '1be950bc-ffb5-4890-a648-b6f50501edb6',
    scriptSrc: 'https://us.umami.is/script.js', // Optional
    router
});

app.use(router).mount('#app');