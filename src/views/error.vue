<script setup lang="ts">
import router from '@/router'
import { Back } from '@element-plus/icons-vue'

function back() {
  router.replace('/taskmanage')
}
</script>
<template>
  <div class="error">
    <div class="title">404</div>
    <el-button type="primary" @click="back" :icon="Back">返回首页</el-button>
  </div>
</template>
<style lang="scss" scoped>
.error {
  height: 100%;
  width: 100%;
  display: grid;
  justify-items: center;
  align-content: center;
  font-size: 100px;
  .title {
    color: var(--swx-error-color);
  }
}
</style>
