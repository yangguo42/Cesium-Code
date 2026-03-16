<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { usePlatformStore } from "@/stores/platform";

const checkList = ref<string[]>([]);
const props = withDefaults(
  defineProps<{
    saveChoice: Function;
  }>(),
  {
    saveChoice: undefined,
  }
);
onMounted(() => {
  usePlatformStore().getCurrentAddScene?.platform.forEach((item) => {
    checkList.value.push(item.id);
  });
});
function saveChoice() {
  let resList: Platform[] = [];
  for (let i = 0; i < checkList.value.length; i++) {
    let name = "";
    switch (checkList.value[i]) {
      case "1":
        name = "侦察机";
        break;
      case "5":
        name = "通信保障车";
        break;
      case "9":
        name = "测控站";
        break;
      default:
        break;
    }
    resList.push({ id: checkList.value[i]!, name: name });
  }

  props.saveChoice(resList);
}
</script>
<template>
  <div>
    <el-checkbox-group v-model="checkList">
      <el-checkbox label="侦察机" value="1" class="checkbox" />
      <!-- <el-checkbox label="预警机" value="2" class="checkbox" />
      <el-checkbox label="反潜机" value="3" class="checkbox" />
      <el-checkbox label="轰炸机" value="4" class="checkbox" /> -->
      <el-checkbox label="通信保障车" value="5" class="checkbox" />
      <!-- <el-checkbox label="雷达车" value="6" class="checkbox" />
      <el-checkbox label="航母" value="7" class="checkbox" />
      <el-checkbox label="舰艇" value="8" class="checkbox" /> -->
      <el-checkbox label="测控站" value="9" class="checkbox" />
      <!-- <el-checkbox label="反潜机" value="10" class="checkbox" />
      <el-checkbox label="其他" value="11" class="checkbox" /> -->
    </el-checkbox-group>
    <br />

    <el-row>
      <el-col :span="20">
        <!-- <el-button>返回</el-button> -->
      </el-col>
      <el-col :span="4">
        <el-button @click="saveChoice">保存</el-button></el-col
      >
    </el-row>
  </div>
</template>
<style lang="scss" scoped>
:deep() .el-checkbox__label {
  color: #2c3e50;
}

.checkbox {
  display: block;
  padding-top: 10px;
  margin-left: 20px;
}
</style>
