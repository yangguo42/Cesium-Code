import { defineStore } from 'pinia'

export const useRouteStore = defineStore('route', () => {
  const currentRoute = ref('/')
  function updateRoute(path: string) {
    currentRoute.value = path
  }
  return { currentRoute, updateRoute }
})
