//import { getLocalStorage } from '@/utils'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
//import Redirect from '@/views/redirect.vue'
import { useMenuStore } from '@/stores/menu'
import { useRouteStore } from '@/stores/route'
const files = import.meta.glob('@/views/**/index.vue')
const routes = Object.entries(files).map(([key, component]) => {
  let tempRoute: RouteRecordRaw = {
    path: '',
    name: '',
    component: component,
    children: [] as RouteRecordRaw[],
    redirect: '',
  }
  let temp = key
    .replace(/\/src\/views\//, '')
    .replace(/\/?index\.vue/gi, '')
    .split('/')
  let name = temp.join('_')
  let path = temp.join('/')
  if (name === '') {
    name = 'home'
  }
  tempRoute.name = name
  tempRoute.path = '/' + path
  return tempRoute
})

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    // {
    //   path: '/',
    //   name: 'redirect',
    //   redirect: '/taskmanage',
    //   component: Redirect,
    //   children: routes,
    // },

    {
      path: '/error',
      name: 'error',
      component: () => import('@/views/error.vue'),
    },
    // {
    //   path: '/login',
    //   name: 'login',
    //   component: () => import('@/views/login.vue'),
    // },
  ],
})
router.beforeEach((to, _from, next) => {
//   let token = getLocalStorage('SWX_TOKEN')
//   if (token === null) {
//     if (to.path === '/login') {
//       document.title = '登陆'
//       next()
//       return
//     }
//     next('/login')
//     return
//   }
  if (!router.hasRoute(to.name!)) {
    next('/error')
    return
  }
  if (to.path === '/error') {
    next()
    document.title = '错误'
    return
  }
  useMenuStore().currentMenu = to.path
  next()
})
router.afterEach((to) => {
  useRouteStore().updateRoute(to.fullPath)
})
export default router
