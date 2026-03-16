<script setup lang="ts">
import { ref, onMounted } from "vue";
const sitScene = ref();
//const props = defineProps(["sceneList"]);
const props = withDefaults(
  defineProps<{
    sceneList: Scene[];
    sitSceneClick: Function;
  }>(),
  {
    sceneList: () => [],
    sitSceneClick: undefined,
  }
);
onMounted(() => {
  if (props.sceneList.length > 1) sitScene.value = props.sceneList[0]?.id;
});
function sitSceneClick(scene: Scene) {
  sitScene.value = scene.id;
  props.sitSceneClick(scene);
}
</script>
<template>
  <div>
    <div
      v-for="(item, index) in props.sceneList"
      :key="index"
      class="sitScene"
      @click="sitSceneClick(item)"
      :class="[sitScene == item.id ? 'sitSceneSelected' : '']"
    >
      <el-row>
        <el-col :span="24"
          ><span class="title">{{ item.title }}</span></el-col
        >
      </el-row>
      <el-row>
        <el-col :span="4">编号:</el-col>
        <el-col :span="12">{{ item.no }}</el-col>
        <el-col :span="4">类型:</el-col>
        <el-col :span="4">{{ item.type }}</el-col>
      </el-row>
      <el-row>
        <el-col :span="4">想定时常:</el-col>
        <el-col :span="19">{{ item.startTime }}~{{ item.endTime }}</el-col>
      </el-row>
      <el-row>
        <el-col :span="4">创建时间:</el-col>
        <el-col :span="20">{{ item.cerateTime }}</el-col>
      </el-row>
      <el-row>
        <el-col :span="4">参与平台:</el-col>
        <el-col :span="20"
          ><div
            class="site"
            v-for="(platform, index) in item.platform"
            :key="`platform${index}`"
          >
            {{ platform.name }}
          </div>
        </el-col>
      </el-row>
    </div>
  </div>
</template>
<style lang="scss" scoped>
.sitSceneSelected {
  background-color: rgb(239, 243, 243);
}
.sitScene {
  cursor: pointer;
  .title {
    font-weight: 700;
  }
  .site {
    background-color: green;
    margin-right: 7px;
    margin-bottom: 7px;
    padding: 1px 4px;
    display: inline-block;
    word-wrap: break-word;
    border-radius: 6px;
  }
}
</style>
