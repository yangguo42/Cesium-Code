<script setup lang="ts">
import type { VxeTableDefines, VxeTablePropTypes } from "vxe-table";
const inputSearch = ref("");
const taskList = ref<Platform[]>([
  { name: "侦察机", id: "1" },
  { name: "通信保障车", id: "5" },
  { name: "测控站", id: "9" },
]);
</script>
<template>
  <div>
    <div style="padding: 10px 0">
      <el-input
        v-model="inputSearch"
        style="width: 160px"
        placeholder="Please input"
      />
      <el-button type="primary">查询</el-button>
      <el-button type="primary">新建</el-button><br />
    </div>
    <vxe-table
      :data="taskList"
      :show-header="true"
      :row-config="{ isHover: true, isCurrent: true }"
      size="mini"
      class="QL-vxetable"
      border="none"
      element-loading-text="任务队列加载中······"
      element-loading-background="rgba(0, 0, 0, 0.8)"
      row-class-name="QL-vxetable-row"
      empty-text="暂无任务列表信息"
      :tooltip-config="{
        theme: 'light',
      }"
    >
      <vxe-column title="id" field="id"> </vxe-column>
      <vxe-column title="平台名称" field="name"> </vxe-column>
      <!-- <vxe-column field="name" show-overflow="tooltip">
        <template #default="{ row }"
          ><p :class="styleTitleColor(row.tskStatus)">{{ row.name }}</p></template
        >
      </vxe-column> -->
    </vxe-table>
  </div>
</template>
<style lang="scss" scoped></style>
