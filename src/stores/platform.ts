import { cloneDeep } from 'lodash-es'
import { defineStore } from 'pinia'

export const usePlatformStore = defineStore('platform_store', () => {
    const currentAddScene = ref<Scene>()
    /**更新当前选择的用户 */
    function updateCurrentAddScene(scene: Scene) {
        currentAddScene.value = scene
    }
     const getCurrentAddScene = computed(() => {
    return cloneDeep(currentAddScene.value)
  })
    return {
        updateCurrentAddScene, 
        getCurrentAddScene
    }
})