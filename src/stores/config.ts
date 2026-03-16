
import { defineStore } from 'pinia'
import { computed, readonly, ref } from 'vue'

export const useConfigStore = defineStore('config', () => {
  interface MenuInfo {
    label: string
    show: boolean
    path: string
    children?: MenuInfo[]
    right?: boolean
  }
  interface PageInfo {
    readonly id: string
    readonly label: string
    readonly show: boolean
    readonly describe?: string
    readonly children?: PageInfo[]
  }
  interface SystemInfo {
    readonly name: string
    readonly title: string
    readonly author: string
  }
  const sourceConfig = ref<{
    systemTitle: SystemInfo
    system: PageInfo[]
  }>({
    systemTitle: {
      name: '',
      title: '',
      author: '',
    },
    system: []
  })
  /**前端配置 */
  const config = computed(() => {
    return readonly(sourceConfig).value
  })
  /**更新前端配置 */
  function updateConfig(conf: any) {
    sourceConfig.value = conf
  }

  /**系统配置 */
  const sourceSysConfigList = ref<DictType[]>([])
  const sysConfigList = computed(() => {
    return readonly(sourceSysConfigList).value
  })
  return { updateConfig,  config, sysConfigList }
})
