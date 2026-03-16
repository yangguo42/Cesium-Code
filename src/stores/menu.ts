import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useMenuStore = defineStore('menu', () => {
  const currentMenu = ref('/')
  function changeMenu(value: string) {
    currentMenu.value = value
  }

  return { currentMenu, changeMenu }
})
