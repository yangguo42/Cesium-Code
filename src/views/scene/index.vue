<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import { EditPen, Delete, CirclePlus } from "@element-plus/icons-vue";
import dayjs from "dayjs";
import { usePlatformStore } from "@/stores/platform";

const inputSearch = ref("");

//const props = defineProps(["handleClick", "saveSceneClick", "sceneList"]);
const props = withDefaults(
  defineProps<{
    handleClick: Function;
    saveSceneClick: Function;
    sceneList: Scene[];
  }>(),
  {
    handleClick: undefined,
    saveSceneClick: undefined,
    sceneList: () => [],
  }
);
const addPlatformClick = (scene: Scene) => {
  props.handleClick({ id: "11_1", show: true, label: "", describe: "" });
  usePlatformStore().updateCurrentAddScene(scene);
};

//#region 新建编辑场景 el-dialog
const sceneModel = ref<Scene>(initScene());
const formRef = useTemplateRef("formRef");
const dialogVisible = ref(false);
const handleClose = (done: () => void) => {
  dialogVisible.value = false;
};
const saveScene = async () => {
  try {
    await formRef.value!.validate();
    let params: Scene = {
      id: "0",
      title: sceneModel.value.title,
      no: sceneModel.value.no,
      type: sceneModel.value.type,
      startTime: sceneModel.value.startTime,
      endTime: sceneModel.value.startTime,
      cerateTime: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      description: sceneModel.value.description,
      platform: [],
    };
    props.saveSceneClick(params);
  } catch (e) {
    console.log(e);
    return false;
  } finally {
    dialogVisible.value = false;
  }
};
//设置初始值
function initScene(): Scene {
  return {
    id: "",
    title: "",
    no: "",
    type: "",
    startTime: dayjs().format("YYYY-MM-DD HH:mm:ss"),
    endTime: dayjs().format("YYYY-MM-DD HH:mm:ss"),
    cerateTime: dayjs().format("YYYY-MM-DD HH:mm:ss"),
    platform: [],
  };
}
//#endregion
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
      <el-button type="primary" @click="dialogVisible = true">新建</el-button
      ><br />
    </div>
    <div v-for="(item, index) in props.sceneList" :key="index">
      <el-row>
        <el-col :span="19"
          ><span class="title">{{ item.title }}</span></el-col
        >
        <el-col :span="5"
          ><el-icon><EditPen /></el-icon>&nbsp;&nbsp;<el-icon
            ><Delete /></el-icon
          >&nbsp;&nbsp;<el-icon @click="addPlatformClick(item)"
            ><CirclePlus /></el-icon
        ></el-col>
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

    <el-dialog
      v-model="dialogVisible"
      title="场景创建"
      width="340"
      :before-close="handleClose"
    >
      <el-form :model="sceneModel" label-width="74px" ref="formRef">
        <el-row>
          <el-col :span="24">
            <el-form-item label="场景名称">
              <el-input
                v-model="sceneModel.title"
                style="width: 96%"
              ></el-input>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="24">
            <el-form-item label="场景类型">
              <el-input v-model="sceneModel.type" style="width: 96%"></el-input>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="24">
            <el-form-item label="开始时间">
              <el-date-picker
                v-model="sceneModel.startTime"
                type="datetime"
                placeholder="Select date and time"
                style="width: 96%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="24">
            <el-form-item label="结束时间">
              <el-date-picker
                v-model="sceneModel.endTime"
                type="datetime"
                placeholder="Select date and time"
                style="width: 96%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :span="24">
            <el-form-item label="场景描述">
              <el-input
                v-model="sceneModel.description"
                style="width: 96%"
                :rows="2"
                type="textarea"
                placeholder=""
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveScene"> 保存场景 </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
<style lang="scss" scoped>
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
</style>
