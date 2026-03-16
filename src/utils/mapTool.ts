import type { Viewer } from "cesium";
import * as Cesium from "cesium";
import {
  createOfflineImageryProvider,
} from "@/utils/cesiumConfig";

import * as satellite from "satellite.js";

let viewer: Viewer | undefined;
// 卫星星历自动/受控运动：每个 tag 对应一个 requestAnimationFrame 循环，避免重复启动
const starTrackAutoMotionRafByTag = new Map<string, number>();
// 卫星“点击播放/暂停”运动的全局暂停标记（由 UI 的播放按钮控制）
let starTrackPlayPaused = true;
// 地图源类型：'goolmap' | 'othermap'
export const mapSource = ref<"goolmap" | "othermap">("goolmap");
// 视图模式：'2D' | '3D'
export const viewMode = ref<"2D" | "3D">("3D");

// 鼠标当前位置（经纬度，度）
export const mouseLng = ref<string | null>(null);

export const mouseLat = ref<string | null>(null);

// 右键菜单相关
export const contextMenuVisible = ref(false);
export const contextMenuX = ref(0);
export const contextMenuY = ref(0);
export const selectedEntity = ref<Cesium.Entity | null>(null);
export const isDrawingPath = ref(false);
export const drawingPathPoints = ref<Cesium.Cartesian3[]>([]);

// 临时绘制的路径实体
let tempPathEntity: Cesium.Entity | null = null;


/** 作战范围（火控/探测等）全局显示开关（界面按钮控制） */
export const battleRangeVisible = ref(true);
// 已创建的作战范围实体集合（用于全局/单体显隐）
let battleRangeEntities: Cesium.Entity[] = [];
// 单体（按 ownerId）可见性：右键菜单可独立控制
const battleRangeOwnerVisible = new Map<string, boolean>();


/** 信号源（扩散波纹/连线等）全局显示开关（界面按钮控制） */
export const signalSourceVisible = ref(true);
// 已创建的信号源实体集合（用于全局/单体显隐）
let signalSourceEntities: Cesium.Entity[] = [];
// 单体（按 ownerId）可见性：右键菜单可独立控制
const signalSourceOwnerVisible = new Map<string, boolean>();


/** 能力探测范围（扇形等）全局显示开关（界面按钮控制） */
export const detectionRangeVisible = ref(true);
// 已创建的能力探测范围实体集合（用于全局/单体显隐）
let detectionRangeEntities: Cesium.Entity[] = [];
// 单体（按 ownerId）可见性：右键菜单可独立控制
const detectionRangeOwnerVisible = new Map<string, boolean>();


/** 播放/暂停与倍速控制（自定义播放控件使用） */
export function playAnimation() {
  if (!viewer) return;
  // 关键：用 TICK_DEPENDENT 让 currentTime 按“上一帧 + multiplier*dt”推进
  // 避免 SYSTEM_CLOCK_MULTIPLIER 跟随系统时间导致采样区间外/看起来不运动
  viewer.clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT;
  // 确保播放时至少是 1x 速度
  const cur = viewer.clock.multiplier;
  // Cesium 默认常见为 60x：点击播放时强制回到 1x（也兼容 0/NaN）
  // 倍速选择由界面 setPlaybackRate 控制；若用户已选其他倍速，这里不会干预
  if (!Number.isFinite(cur) || cur === 0 || cur === 60) {
    viewer.clock.multiplier = 1;
  }
  viewer.clock.shouldAnimate = true;
  viewer.clock.canAnimate = true;
  // 同时恢复星轨“播放模式”的运动
  starTrackPlayPaused = false;
}

/** 暂停播放 */
export function pauseAnimation() {
  if (!viewer) return;
  viewer.clock.shouldAnimate = false;
  // 同时暂停星轨“播放模式”的运动
  starTrackPlayPaused = true;
}

/** 设置播放倍速 */
export function setPlaybackRate(rate: number) {
  if (!viewer) return;
  viewer.clock.multiplier = rate;
}

/** 按北京时间字符串设置时钟区间（给界面时间滑动块使用） */
export function setClockRangeByBjTimeStrings(startBj: string, endBj: string) {
  if (!viewer) return;
  const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;
  const parseBj = (t: string): Date => {
    const m = String(t)
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (!m) return new Date(NaN);
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = Number(m[6]);
    // 将北京时间转换为 UTC：UTC = BJ - 8h
    const ms = Date.UTC(y, mo - 1, d, hh, mm, ss) - BJ_OFFSET_MS;
    return new Date(ms);
  };

  const startUtc = parseBj(startBj);
  const endUtc = parseBj(endBj);
  if (!isFinite(startUtc.getTime()) || !isFinite(endUtc.getTime())) return;
  if (endUtc.getTime() <= startUtc.getTime()) return;

  const start = Cesium.JulianDate.fromDate(startUtc);
  const stop = Cesium.JulianDate.fromDate(endUtc);
  viewer.clock.startTime = start.clone();
  viewer.clock.stopTime = stop.clone();
  // currentTime 默认落到起点，播放时自然往后走
  viewer.clock.currentTime = start.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT;
  viewer.timeline?.zoomTo(start, stop);
  viewer.scene.requestRender();
}

/** 设置所有作战范围是否显示（内部使用） */
function setAllBattleRangesVisible(visible: boolean) {
  battleRangeVisible.value = visible;
  battleRangeEntities.forEach(applyBattleRangeVisibility);
  viewer?.scene.requestRender();
}

/** 切换所有作战范围显隐（界面按钮用） */
export function toggleAllBattleRangesVisible() {
  setAllBattleRangesVisible(!battleRangeVisible.value);
}

/** 设置“当前右键选中实体”的作战范围是否显示（内部使用） */
function setSelectedBattleRangeVisible(visible: boolean) {
  if (!selectedEntity.value) return;
  const ownerId = selectedEntity.value.id;
  battleRangeOwnerVisible.set(ownerId, visible);
  battleRangeEntities.forEach((e) => {
    if (getEntityPropString(e, "battleRangeOwnerId") === ownerId) {
      applyBattleRangeVisibility(e);
    }
  });
  viewer?.scene.requestRender();
}

/** 切换“当前右键选中实体”的作战范围显隐（右键菜单用） */
export function toggleSelectedBattleRangeVisible() {
  if (!selectedEntity.value) return;
  const ownerId = selectedEntity.value.id;
  const next = !(battleRangeOwnerVisible.get(ownerId) ?? true);
  setSelectedBattleRangeVisible(next);
}

/** 当前右键选中实体是否存在已注册的作战范围（用于右键菜单是否展示） */
export function hasSelectedBattleRange(): boolean {
  if (!selectedEntity.value) return false;
  const ownerId = selectedEntity.value.id;
  return battleRangeEntities.some((e) => getEntityPropString(e, "battleRangeOwnerId") === ownerId);
}

/** 获取当前右键选中实体的作战范围“目标态显示值”（不含全局开关叠加） */
export function getSelectedBattleRangeLocalVisible(): boolean {
  if (!selectedEntity.value) return true;
  const ownerId = selectedEntity.value.id;
  return battleRangeOwnerVisible.get(ownerId) ?? true;
}

/** 设置所有信号源是否显示（内部使用） */
function setAllSignalSourcesVisible(visible: boolean) {
  signalSourceVisible.value = visible;
  signalSourceEntities.forEach(applySignalSourceVisibility);
  viewer?.scene.requestRender();
}

/** 切换所有信号源显隐（界面按钮用） */
export function toggleAllSignalSourcesVisible() {
  setAllSignalSourcesVisible(!signalSourceVisible.value);
}

/** 设置“当前右键选中实体”的信号源是否显示（内部使用） */
function setSelectedSignalSourceVisible(visible: boolean) {
  if (!selectedEntity.value) return;
  const ownerId = selectedEntity.value.id;
  signalSourceOwnerVisible.set(ownerId, visible);
  signalSourceEntities.forEach((e) => {
    if (getEntityPropString(e, "signalSourceOwnerId") === ownerId) {
      applySignalSourceVisibility(e);
    }
  });
  viewer?.scene.requestRender();
}

/** 切换“当前右键选中实体”的信号源显隐（右键菜单用） */
export function toggleSelectedSignalSourceVisible() {
  if (!selectedEntity.value) return;
  const ownerId = selectedEntity.value.id;
  const next = !(signalSourceOwnerVisible.get(ownerId) ?? true);
  setSelectedSignalSourceVisible(next);
}

/** 当前右键选中实体是否存在已注册的信号源（用于右键菜单是否展示） */
export function hasSelectedSignalSource(): boolean {
  if (!selectedEntity.value) return false;
  const ownerId = selectedEntity.value.id;
  return signalSourceEntities.some((e) => getEntityPropString(e, "signalSourceOwnerId") === ownerId);
}

/** 获取当前右键选中实体的信号源“目标态显示值”（不含全局开关叠加） */
export function getSelectedSignalSourceLocalVisible(): boolean {
  if (!selectedEntity.value) return true;
  const ownerId = selectedEntity.value.id;
  return signalSourceOwnerVisible.get(ownerId) ?? true;
}

/** 设置所有能力探测范围是否显示（内部使用） */
function setAllDetectionRangesVisible(visible: boolean) {
  detectionRangeVisible.value = visible;
  detectionRangeEntities.forEach(applyDetectionRangeVisibility);
  viewer?.scene.requestRender();
}

/** 切换所有能力探测范围显隐（界面按钮用） */
export function toggleAllDetectionRangesVisible() {
  setAllDetectionRangesVisible(!detectionRangeVisible.value);
}

/** 设置“当前右键选中实体”的能力探测范围是否显示（内部使用） */
function setSelectedDetectionRangeVisible(visible: boolean) {
  if (!selectedEntity.value) return;
  const ownerId = selectedEntity.value.id;
  detectionRangeOwnerVisible.set(ownerId, visible);
  detectionRangeEntities.forEach((e) => {
    if (getEntityPropString(e, "detectionRangeOwnerId") === ownerId) {
      applyDetectionRangeVisibility(e);
    }
  });
  viewer?.scene.requestRender();
}

/** 切换“当前右键选中实体”的能力探测范围显隐（右键菜单用） */
export function toggleSelectedDetectionRangeVisible() {
  if (!selectedEntity.value) return;
  const ownerId = selectedEntity.value.id;
  const next = !(detectionRangeOwnerVisible.get(ownerId) ?? true);
  setSelectedDetectionRangeVisible(next);
}

/** 当前右键选中实体是否存在已注册的能力探测范围（用于右键菜单是否展示） */
export function hasSelectedDetectionRange(): boolean {
  if (!selectedEntity.value) return false;
  const ownerId = selectedEntity.value.id;
  return detectionRangeEntities.some(
    (e) => getEntityPropString(e, "detectionRangeOwnerId") === ownerId
  );
}

/** 获取当前右键选中实体的能力探测范围“目标态显示值”（不含全局开关叠加） */
export function getSelectedDetectionRangeLocalVisible(): boolean {
  if (!selectedEntity.value) return true;
  const ownerId = selectedEntity.value.id;
  return detectionRangeOwnerVisible.get(ownerId) ?? true;
}


//创建初始离线地图提供者（默认使用 goolmap）
export function initMap(): Viewer | undefined {

  const offlineImageryProvider = createOfflineImageryProvider(
    "/maps/goolmap/{z}/{x}/{y}.png",
    { minimumLevel: 1, maximumLevel: 5, credit: "goolmap(离线)" }
  );


  viewer = new Cesium.Viewer("cesiumContainer", {

    // 1. 禁用动画播放控件（播放/暂停/速度调节按钮）
    animation: false,
    // 2. 禁用时间轴（底部的时间滑块）
    timeline: false,
    //sceneMode: Cesium.SceneMode.SCENE3D,
    // 禁用默认的 Ion 底图选择器
    baseLayerPicker: false,
    fullscreenButton: false, // 禁用全屏按钮
    homeButton: false, // 禁用主页按钮（回到初始视角）
    sceneModePicker: false, // 禁用3D/2D/2.5D 切换按钮
    navigationHelpButton: false, // 禁用导航帮助按钮
    geocoder: false, // 禁用地理编码搜索框
    selectionIndicator: false, // 禁用选中实体的指示器
    infoBox: false, // 禁用点击实体弹出的信息框
    navigationInstructionsInitiallyVisible: false, // 禁用导航提示
  });

  // 移除默认的 Ion 底图，使用离线底图
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(offlineImageryProvider);
  viewer.scene.requestRender();

  // 若启用了 requestRenderMode，播放时钟推进不会自动触发渲染；这里兜底在每次 tick 请求渲染
  viewer.clock.onTick.addEventListener(() => {
    viewer?.scene.requestRender();
  });

  // 直接隐藏版权容器（最彻底）
  (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';

  //viewer.scene.screenSpaceCameraController.enableInputs = false; // 禁用相机操作

  if (viewer.scene.mode === Cesium.SceneMode.SCENE3D) {
    //      viewer.scene.morphTo2D(5.5);
    //    else {
    //      viewer.scene.morphTo3D(5.5);
    //    }
  }
  return viewer;
} 




// 切换地图源（goolmap 与 othermap）
export function switchMapSource() {
  if (!viewer) return;

  // 切换状态
  mapSource.value = mapSource.value === "goolmap" ? "othermap" : "goolmap";

  // 先清空现有图层
  viewer.imageryLayers.removeAll();

  if (mapSource.value === "goolmap") {
    // goolmap：单一底图，PNG 瓦片
    const baseProvider = createOfflineImageryProvider(
      "/maps/goolmap/{z}/{x}/{y}.png",
      { minimumLevel: 1, maximumLevel: 5, credit: "goolmap(离线)" }
    );
    viewer.imageryLayers.addImageryProvider(baseProvider);
  } else {
    // othermap：底图为 satellite，名字/标注图层为 overlay
    const satelliteProvider = createOfflineImageryProvider(
      "/maps/othermap/satellite/{z}/{x}/{y}.jpg",
      { minimumLevel: 1, maximumLevel: 5, credit: "othermap-satellite(离线)" }
    );
    const overlayProvider = createOfflineImageryProvider(
      "/maps/othermap/overlay/{z}/{x}/{y}.png",
      { minimumLevel: 1, maximumLevel: 5, credit: "othermap-overlay(离线)" }
    );

    // 先添加卫星底图，再叠加名字/标注图层
    viewer.imageryLayers.addImageryProvider(satelliteProvider);
    viewer.imageryLayers.addImageryProvider(overlayProvider);
  }

  // 开了 requestRenderMode 时，程序化切换图层后手动触发一次渲染更稳
  viewer.scene.requestRender();
}


// 切换2D/3D视图模式
export function switchViewMode() {
  if (!viewer) return;

  if (viewMode.value === "3D") {
    // 切换到2D
    viewMode.value = "2D";
    viewer.scene.morphTo2D(1.0);
  } else {
    // 切换到3D
    viewMode.value = "3D";
    viewer.scene.morphTo3D(1.0);
  }

  viewer.scene.requestRender();
}

// 鼠标移动时，返回经纬度信息
export function mousePosition(handler: Cesium.ScreenSpaceEventHandler, viewer: Viewer) {
  if (!viewer) return;
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    if (!viewer) return;
    const cartesian = viewer.camera.pickEllipsoid(
      movement.endPosition,
      viewer.scene.globe.ellipsoid
    );
    if (!cartesian) {
      mouseLng.value = null;
      mouseLat.value = null;
      return;
    }
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    mouseLng.value = Cesium.Math.toDegrees(cartographic.longitude).toFixed(6);
    mouseLat.value = Cesium.Math.toDegrees(cartographic.latitude).toFixed(6);
  }, 
  Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

  // 右键点击事件：检测是否点击到实体（点位/图标）
export function rightclickEvent(handler: Cesium.ScreenSpaceEventHandler,viewer: Viewer){
  if (!viewer) return;

  // 鼠标移动到实体（billboard）上时，显示手型光标
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    if (!viewer) return;
    const picked = viewer.scene.pick(movement.endPosition);
    if (picked && Cesium.defined(picked.id)) {
      const entity = picked.id as Cesium.Entity;
      if (entity.billboard) {
        viewer.canvas.style.cursor = "pointer";
        return;
      }
    }
    // 未悬停在可点实体上时恢复默认
    viewer.canvas.style.cursor = "default";
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (!viewer) return;
    
    // 如果正在绘制航迹，点击地图添加点
    if (isDrawingPath.value) {
      const cartesian = viewer.camera.pickEllipsoid(
        click.position,
        viewer.scene.globe.ellipsoid
      );
      if (cartesian) {
        // 与 drawingVoyagePath 中保持一致：给航迹点设置固定高度，避免 3D 模式下贴地
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const PATH_HEIGHT = 400000;
        carto.height = PATH_HEIGHT;
        const cartesianWithHeight = Cesium.Cartesian3.fromRadians(
          carto.longitude,
          carto.latitude,
          carto.height
        );
        drawingPathPoints.value.push(cartesianWithHeight);
        viewer.scene.requestRender();
      }
      return;
    }

    // 检测是否点击到实体（使用 drillPick，避免 2D 模式下被扩散波纹等图形遮挡）
    const pickedObjects = viewer.scene.drillPick(click.position);
    let pickedBillboardEntity: Cesium.Entity | null = null;
    for (const picked of pickedObjects) {
      if (picked && Cesium.defined((picked as any).id)) {
        const e = (picked as any).id as Cesium.Entity;
        if (e.billboard) {
          pickedBillboardEntity = e;
          break;
        }
      }
    }

    if (pickedBillboardEntity) {
      selectedEntity.value = pickedBillboardEntity;
        contextMenuX.value = click.position.x;
        contextMenuY.value = click.position.y;
        contextMenuVisible.value = true;
    } else {
      // 点击空白处，隐藏菜单
      contextMenuVisible.value = false;
      selectedEntity.value = null;
    }
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // 点击其他地方时隐藏右键菜单
  handler.setInputAction(() => {
    if (!isDrawingPath.value) {
      contextMenuVisible.value = false;
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

}

// 右键点击事件：不检测是否点击到实体（点位/图标），在任意位置弹出菜单或添加航迹点
export function rightclickEventWithoutPick(
  handler: Cesium.ScreenSpaceEventHandler,
  viewer: Viewer
) {
  if (!viewer) return;

  handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (!viewer) return;

    // 如果正在绘制航迹，右键点击地图添加点
    if (isDrawingPath.value) {
      const cartesian = viewer.camera.pickEllipsoid(
        click.position,
        viewer.scene.globe.ellipsoid
      );
      if (cartesian) {
        // 与 drawingVoyagePath 中保持一致：给航迹点设置固定高度，避免 3D 模式下贴地
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const PATH_HEIGHT = 400000;
        carto.height = PATH_HEIGHT;
        const cartesianWithHeight = Cesium.Cartesian3.fromRadians(
          carto.longitude,
          carto.latitude,
          carto.height
        );
        drawingPathPoints.value.push(cartesianWithHeight);
        viewer.scene.requestRender();
      }
      return;
    }

    // 不做实体拾取检查，直接在点击位置弹出右键菜单
    contextMenuX.value = click.position.x;
    contextMenuY.value = click.position.y;
    contextMenuVisible.value = true;
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // 左键点击隐藏右键菜单（若未处于航迹绘制模式）
  handler.setInputAction(() => {
    if (!isDrawingPath.value) {
      contextMenuVisible.value = false;
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}



/*
 * 固定站参数
 * @param lon 经度
 * @param lat 纬度
 * @param alt 高度(米)，默认 0
 * @param image 图片路径
 * @param name 名称
 * @param labelFont 标签字体，默认 "12pt 微软雅黑"
 */
export interface FixedStationParams{
  lon: number; 
  lat: number; 
  alt?: number; 
  image: string;
  name: string;
  labelFont?: string;
}
/**
 * 绘制固定站位置
 * @param options 固定站参数
 * @returns 固定站实体
 */
export function drawFixedStation(options: FixedStationParams): Cesium.Entity | undefined {
  if(!viewer) return;
  const {
    lon,
    lat,
    alt,
    image,
    name,
    labelFont,
  } = options;
  const labelFontLocal = labelFont || "12pt 微软雅黑";
  const altLocal = alt ?? 0;
  const center = Cesium.Cartesian3.fromDegrees(lon, lat, altLocal);
  // 绘制固定站实体
  const stationEntity = viewer.entities.add({
    name,
    position: center,
    // 贴图配置（billboard）
    billboard: {
      image, // 贴图路径（本地/网络图片均可）
      width: 30,                // 贴图宽度（像素）
      height: 30,               // 贴图高度（像素）
      verticalOrigin: Cesium.VerticalOrigin.CENTER, // 锚点居中
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      scale: 1.0,               // 缩放比例
      color: Cesium.Color.TURQUOISE // 贴图颜色（默认白色，不修改原图）
    },
    //可选：添加标签
    label: {
      text: name,
      font: labelFontLocal,
      pixelOffset: new Cesium.Cartesian2(-20, -40), // 标签在贴图下方
      fillColor: Cesium.Color.BLACK,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1
    }
  });
  return stationEntity;
}


/**
 * 运动实体参数
 * @param name 实体名称
 * @param waypoints 航迹点
 * @param detectionRange 能力探测范围(雷达范围)扇形
 * @param fireRange 火力范围(圆形)
 * @param signalSource 信号源扩散波纹
 * @param speed 运动速度（米/秒），默认 100
 * @param startTime 航迹起始时间
 * @param endTime 航迹结束时间
 * @param imageUrl 实体贴图路径
 * @param trackColor 航迹线颜色，默认红色
 * @param trackWidth 航迹线宽度 默认2
 * @param labelFont 标签字体，默认 "12pt 微软雅黑"
 */
export interface MovingStationParams{
  name: string; // 实体名称
  /** 航迹点 */
  waypoints: {
    lon: number; //经度
    lat: number; //纬度
    height: number; //高度(米)，默认 0  
  }[];
  /** 能力探测范围(雷达范围)扇形：跟随运动实体 */
  detectionRange?: {
    radius: number; // 半径（米）
    startAngle: number; // 起始角（度，相对于正北顺时针）
    endAngle: number; // 终止角（度，相对于正北顺时针）
    color?: Cesium.Color | string; //扇形颜色
    /** 扇形高度（米） */
    height?: number;
    /** 实体名称 */
    name?: string;
  };
  /** 火力范围（圆形，常用于配合运动实体展示） */
  fireRange?: {
    radius: number;
    color?: Cesium.Color | string;
    height?: number;
    name?: string;
  };
  /** 信号源扩散（常用于配合运动实体展示） */
  signalSource?: {
    distance: number;
    color?: Cesium.Color | string;
    height?: number;
    namePrefix?: string;
  };
  speed?: number; // 运动速度（米/秒），默认 100
  startTime: Date; // 航迹起始时间
  endTime: Date; //航迹结束时间
  imageUrl: string; // 实体贴图路径
  trackColor?: Cesium.Color; // 航迹线颜色，默认红色
  trackWidth: number; // 航迹线宽度 默认2
  labelFont?: string; //标签字体，默认 "12pt 微软雅黑"
}

/**
 * 绘制运动实体
 * @param options 运动实体参数
 * @returns 运动实体
 */
export function drawMovingStation(options: MovingStationParams): Cesium.Entity | undefined {
  if(!viewer) return;
  const {
    name,
    waypoints,
    startTime,
    endTime,
    imageUrl,
    trackColor = Cesium.Color.RED,
    trackWidth = 2,
    labelFont,
  } = options;
  const labelFontLocal = labelFont || "12pt 微软雅黑";

  if (!waypoints?.length) return;
  if (!startTime || !endTime) return;

  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const durationSeconds = (endMs - startMs) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

  const startJD = Cesium.JulianDate.fromDate(startTime);
  const stopJD = Cesium.JulianDate.fromDate(endTime);

  // 经纬度转笛卡尔坐标（ECEF）
  const positions: Cesium.Cartesian3[] = waypoints.map((p) =>
    Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height ?? 0)
  );

  const sampledPosition = new Cesium.SampledPositionProperty();
  // 以传入航迹点为基准：线性插值即可（严格点-点连线），不做高阶插值以避免偏离/过冲
  sampledPosition.setInterpolationOptions({
    interpolationAlgorithm: Cesium.LinearApproximation,
    interpolationDegree: 1,
  });

  // 计算每个点的“累计距离占比”，把时间铺满 startTime~endTime
  const distances: number[] = [0];
  let totalDistance = 0;
  for (let i = 1; i < positions.length; i++) {
    const d = Cesium.Cartesian3.distance(positions[i - 1] ?? Cesium.Cartesian3.ZERO, positions[i] ?? Cesium.Cartesian3.ZERO);
    totalDistance += d;
    distances.push(totalDistance);
  }

  // 如果全部点重合，则等间隔分配时间；否则按距离占比分配
  for (let i = 0; i < positions.length; i++) {
    const ratio = totalDistance > 0 ? (distances[i] ?? 0) / totalDistance : (positions.length === 1 ? 0 : i / (positions.length - 1));
    const t = Cesium.JulianDate.addSeconds(startJD, durationSeconds * ratio, new Cesium.JulianDate());
    sampledPosition.addSample(t, positions[i] ?? Cesium.Cartesian3.ZERO);
  }

  // 创建运动实体（贴图 + 路径）
  const movingEntity = viewer.entities.add({
    name,
    position: sampledPosition,
    orientation: new Cesium.VelocityOrientationProperty(sampledPosition),
    billboard: {
      image: imageUrl,
      width: 30,
      height: 30,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scale: 1.2
    },
    label: {
      text: name,
      font: labelFontLocal,
      pixelOffset: new Cesium.Cartesian2(0, -40),
      fillColor: Cesium.Color.BLACK,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2
    },
    path: {
      width: trackWidth,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.2,
        color: trackColor,
      }),
      // 仅保留历史轨迹，时长与实际运动时长一致，减少长时间段下的绘制开销
      leadTime: 0,
      trailTime: durationSeconds,
      // 适中分辨率，兼顾平滑度与性能
      resolution: 60,
    }
  });

  // 绘制完整航迹线（静态）
  viewer.entities.add({
    name: `${name}-完整航迹线`,
    polyline: {
      positions,
      width: Math.max(1, trackWidth - 1),
      material: trackColor.withAlpha(0.5),
      clampToGround: false,
      // 让线在球面上更顺滑（仍以传入点为控制点）
      arcType: Cesium.ArcType.GEODESIC,
      granularity: Cesium.Math.RADIANS_PER_DEGREE,
    }
  });

  // 配置时钟，启动航迹运动（按传入时间段）
  viewer.clock.startTime = startJD;
  viewer.clock.stopTime = stopJD;
  viewer.clock.currentTime = startJD;
  // 绑定播放按钮：初始化不自动播放，等用户点击播放再运动（shouldAnimate 由外部控制）
  // viewer.clock.multiplier 也不在此处强制覆盖，避免影响全局播放倍速
  // viewer.clock.shouldAnimate = true;

  return movingEntity;
}


/**
 * 能力探测范围(雷达范围)扇形参数
 * @param center 扇形中心点（可为静态 Cartesian3、动态 Property 或 Entity）
 * @param radius 半径（米）
 * @param startAngle 起始角（度，相对于正北顺时针）
 * @param endAngle 终止角（度，相对于正北顺时针）
 * @param color 扇形颜色（默认红色），既用于填充也用于描边
 * @param ownerId 关联实体 id（用于管理/显隐）
 * @param name 实体名称
 * @param height 扇形高度（米）
 * @param scanEnabled 是否开启扫描（开启后扇形会绕中心持续旋转）
 * @param scanPeriodSeconds 扫描一周的周期（秒）。默认 10 秒
 */
export interface DetectionRangeOptions {
  /** 扇形中心点（可为静态 Cartesian3、动态 Property 或 Entity） */
  center: Cesium.Cartesian3 | Cesium.Property | Cesium.Entity;
  radius: number; // 半径（米）
  startAngle: number; // 起始角（度，相对于正北顺时针）
  endAngle: number; // 终止角（度，相对于正北顺时针）
  color?: Cesium.Color | string; //扇形颜色
  /** 是否开启扫描（开启后扇形会绕中心持续旋转） */
  scanEnabled?: boolean;
  /** 扫描一周的周期（秒）。默认 10 秒 */
  scanPeriodSeconds?: number;
  /** 关联的实体 id（用于显隐/管理） */
  ownerId?: string;
  /** 实体名称 */
  name?: string;
  /** 扇形高度（米） */
  height?: number;
}
/**
 * 绘制能力探测范围(雷达范围)
 * @param options 能力探测范围(雷达范围)参数
 * @returns 能力探测范围(雷达范围)实体
 */
export async function detectionRange(options: DetectionRangeOptions): Promise<void> {
  if (!viewer) return;
  await Promise.resolve();
  const {
    center,
    radius,
    startAngle,
    endAngle,
    color = Cesium.Color.RED,
    scanEnabled = false,
    scanPeriodSeconds = 10,
    ownerId,
    name = "能力探测范围(雷达范围)",
    height = 0,
  } = options;

  if (!center) return;
  if (!radius || radius <= 0) return;
  if (startAngle === endAngle) return;

  // 颜色处理：填充 0.3 透明度 + 描边不透明
  const outlineColorValue =
    typeof color === "string" ? Cesium.Color.fromCssColorString(color) || Cesium.Color.RED : color;
  const fillColorValue = outlineColorValue.withAlpha(0.3);

  let startRad = Cesium.Math.toRadians(startAngle);
  let endRad = Cesium.Math.toRadians(endAngle);
  let sweep = endRad - startRad;
  if (sweep < 0) sweep += 2 * Math.PI;
  if (sweep <= 0) return;

  const steps = 64;
  const step = sweep / steps;

  // 判断 center 类型，确定是静态还是动态
  let centerPosition: Cesium.Cartesian3 | Cesium.Property;
  let isDynamic = false;

  if (center instanceof Cesium.Entity) {
    // Entity：使用其 position 属性（动态）
    centerPosition = center.position as Cesium.Property;
    isDynamic = true;
  } else if (center instanceof Cesium.Cartesian3) {
    // 静态 Cartesian3
    centerPosition = center;
    isDynamic = false;
  } else {
    // Property（动态）
    centerPosition = center;
    isDynamic = true;
  }

  // 记录上一次中心点，避免 position 暂时取不到导致扇形闪烁/消失
  let lastCenter: Cesium.Cartesian3 | undefined;

  // 获取中心点的函数
  const getCenterAtTime = (time: Cesium.JulianDate | undefined): Cesium.Cartesian3 | undefined => {
    if (!time) return lastCenter;
    if (centerPosition instanceof Cesium.Cartesian3) {
      return centerPosition;
    }
    const pos = centerPosition.getValue(time) as Cesium.Cartesian3 | undefined;
    if (pos) lastCenter = pos;
    return pos || lastCenter;
  };

  // 构建扇形点的函数（rotationRad: 本次扫描额外旋转角）
  const buildSectorPoints = (center: Cesium.Cartesian3, rotationRad = 0): Cesium.Cartesian3[] => {
    const enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const pts: Cesium.Cartesian3[] = [];
    pts.push(center);
    for (let i = 0; i <= steps; i++) {
      const angle = startRad + rotationRad + step * i;
      const local = new Cesium.Cartesian3(
        radius * Math.sin(angle), // East
        radius * Math.cos(angle), // North
        0
      );
      const world = Cesium.Matrix4.multiplyByPoint(enuFrame, local, new Cesium.Cartesian3());
      pts.push(world);
    }
    return pts;
  };

  // 根据是否动态选择 hierarchy
  let hierarchy: Cesium.PolygonHierarchy | Cesium.Property;
  const seconds =
    typeof scanPeriodSeconds === "number" && Number.isFinite(scanPeriodSeconds) && scanPeriodSeconds > 0
      ? scanPeriodSeconds
      : 10;
  const periodMs = seconds * 1000;
  const scanOn = !!scanEnabled && Number.isFinite(periodMs) && periodMs > 0;
  if (isDynamic || scanOn) {
    // 以“首次回调的时间”为基准，保证初始化时 rotation=0
    let baseTime: Cesium.JulianDate | undefined;
    hierarchy = new Cesium.CallbackProperty((time: Cesium.JulianDate | undefined) => {
      const centerPos = getCenterAtTime(time);
      if (!centerPos) {
        return lastCenter ? new Cesium.PolygonHierarchy([lastCenter]) : new Cesium.PolygonHierarchy([]);
      }
      let rotationRad = 0;
      if (scanOn && time) {
        if (!baseTime) baseTime = Cesium.JulianDate.clone(time);
        const rawMs = Cesium.JulianDate.secondsDifference(time, baseTime) * 1000;
        const t = ((rawMs % periodMs) + periodMs) % periodMs;
        rotationRad = (t / periodMs) * Cesium.Math.TWO_PI;
      }
      const pts = buildSectorPoints(centerPos, rotationRad);
      return new Cesium.PolygonHierarchy(pts);
    }, false);
  } else {
    // 静态：直接构建
    const staticCenter = centerPosition as Cesium.Cartesian3;
    const pts = buildSectorPoints(staticCenter, 0);
    hierarchy = new Cesium.PolygonHierarchy(pts);
  }

  const sectorEntity = viewer.entities.add({
    name,
    properties: {
      drawShapeFlag: true,
      drawShapeType: "detection-sector",
      detectionRangeFlag: true,
      detectionRangeOwnerId: ownerId,
      detectionRangeFollowFlag: isDynamic,
    } as any,
    polygon: {
      hierarchy: hierarchy as any,
      material: fillColorValue,
      outline: true,
      outlineColor: outlineColorValue,
      outlineWidth: 3,
      height,
    },
  });
  if (sectorEntity) registerDetectionRangeEntity(sectorEntity);
}


/**
 * 作战范围(火控范围)圆形参数
 * @param center 圆心位置（可为静态 Cartesian3 或动态 Property）
 * @param radius 半径（米）
 * @param color 圆形颜色（默认红色），既用于填充也用于描边
 * @param ownerId 关联实体 id（用于管理/显隐）
 * @param name 实体名称
 * @param height 圆形高度（可为 number 或动态 Property）
 */
export interface FireControlRangeCircleOptions {
  center: Cesium.Cartesian3 | Cesium.Property;
  radius: number; // 半径（米）
  color?: Cesium.Color | string;
  ownerId?: string;
  name?: string;
  height?: number | Cesium.Property;
}
//绘制作战范围(火控范围)圆形——异步加载
export async function drawFireControlRangeCircle(
  options: FireControlRangeCircleOptions
): Promise<void> {
  if (!viewer) return;
  const {
    center,
    radius,
    color = Cesium.Color.RED,
    ownerId,
    name = "作战范围(火控范围)",
    height = 0,
  } = options;

  if (!center) return;
  if (!radius || radius <= 0) return;

  const outlineColorValue =
    typeof color === "string" ? Cesium.Color.fromCssColorString(color) || Cesium.Color.RED : color;
  const fillColorValue = outlineColorValue.withAlpha(0.3);

  const rangeEntity = viewer.entities.add({
    name,
    position: center as any,
    properties: {
      drawShapeFlag: true,
      drawShapeType: "battleRange-fireControl",
      battleRangeFlag: true,
      battleRangeOwnerId: ownerId,
    } as any,
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      material: fillColorValue,
      outline: true,
      outlineColor: outlineColorValue,
      outlineWidth: 3,
      height: height as any,
    },
  });
  if (rangeEntity) registerBattleRangeEntity(rangeEntity);
}




/**
 * 信号源扩散波纹绘制参数
 * @param center 扩散源中心点（可为静态 Cartesian3、动态 Property 或 Entity）
 * @param distance 扩散最大距离（米）
 * @param rippleCount 扩散波纹条数
 * @param showRipple 是否显示扩散波纹
 * @param rippleDurationMs 单条波纹从内到外扩散一圈的周期（毫秒），越小越快
 * @param rippleColor 扩散波纹颜色
 * @param height 高度（可为 number 或动态 Property）
 * @param ownerId 关联的实体 id（用于显隐/管理）
 * @param namePrefix 实体名称前缀
 */
export interface SignalRippleOptions {
  /** 扩散源中心点（可为静态 Cartesian3、动态 Property 或 Entity） */
  center: Cesium.Cartesian3 | Cesium.Property | Cesium.Entity;
  /** 扩散最大距离（米） */
  distance: number;
  /** 扩散波纹条数 */
  rippleCount?: number;
  /** 是否显示扩散波纹 */
  showRipple?: boolean;
  /** 单条波纹从内到外扩散一圈的周期（毫秒），越小越快 */
  rippleDurationMs?: number;
  /** 扩散波纹颜色 */
  rippleColor?: Cesium.Color | string;
  /** 高度（可为 number 或动态 Property） */
  height?: number | Cesium.Property;
  /** 关联的实体 id（用于显隐/管理） */
  ownerId?: string;
  /** 实体名称前缀 */
  namePrefix?: string;
}
/**
 * 绘制信号源扩散波纹
 * @param options 信号源扩散波纹参数
 * @returns 信号源扩散波纹实体
 */
export async function drawSignalRipple(options: SignalRippleOptions): Promise<void> {
  if (!viewer) return;
  const {
    center,
    distance,
    rippleCount = 5,
    showRipple = true,
    rippleDurationMs = 6000,
    rippleColor = Cesium.Color.DARKORANGE,
    height = 0,
    ownerId,
    namePrefix = "信号源扩散波纹",
  } = options;

  if (!center) return;
  if (!showRipple) return;
  if (!distance || distance <= 0) return;
  if (!rippleCount || rippleCount <= 0) return;
  if (!rippleDurationMs || rippleDurationMs <= 0) return;

  // 判断 center 类型，统一转换为 Property
  let centerPosition: Cesium.Cartesian3 | Cesium.Property;
  if (center instanceof Cesium.Entity) {
    // Entity：使用其 position 属性（动态）
    centerPosition = center.position as Cesium.Property;
    if (!centerPosition) return;
  } else {
    // Cartesian3 或 Property：直接使用
    centerPosition = center;
  }

  const colorValue =
    typeof rippleColor === "string"
      ? Cesium.Color.fromCssColorString(rippleColor) || Cesium.Color.DARKORANGE
      : rippleColor;

  const totalPhaseTime = rippleDurationMs;
  const phaseStep = totalPhaseTime / rippleCount;

  for (let i = 0; i < rippleCount; i++) {
    const phaseOffset = i * phaseStep;
    // 以"首次回调的时间"为基准，保证初始化时 t=0（波纹不扩散），
    // 之后跟随 Cesium 时钟推进
    let baseTime: Cesium.JulianDate | undefined;
    const rippleEntity = viewer.entities.add({
      name: `${namePrefix}${i}`,
      position: centerPosition as any,
      properties: {
        signalSourceFlag: true,
        signalSourceType: "signalSource-ripple",
        signalSourceOwnerId: ownerId,
      } as any,
      ellipse: {
        show: true,
        semiMajorAxis: new Cesium.CallbackProperty((time: Cesium.JulianDate | undefined) => {
          if (!time) {
            return 1000;
          }
          if (!baseTime) {
            baseTime = Cesium.JulianDate.clone(time);
          }
          // 使用 Cesium 时钟的「物理秒」差值，并按 multiplier 抵消倍速影响，
          // 保证波纹扩散速度在不同播放倍速下保持一致
          const rawMs = Cesium.JulianDate.secondsDifference(time, baseTime) * 1000;
          const clock = viewer!.clock;
          const speedFactor = Math.max(1, Math.abs(clock.multiplier)); // 至少为 1，避免除以 0
          // 再除以 9，使波纹扩散整体速度减半
          const ms = rawMs / (speedFactor * 9);
          const t = ((ms + phaseOffset) % totalPhaseTime) / totalPhaseTime;
          const radius = 1000 + distance * 0.8 * t;
          return radius;
        }, false),
        semiMinorAxis: new Cesium.CallbackProperty((time: Cesium.JulianDate | undefined) => {
          if (!time) {
            return 1000 * 0.999999;
          }
          if (!baseTime) {
            baseTime = Cesium.JulianDate.clone(time);
          }
          const rawMs = Cesium.JulianDate.secondsDifference(time, baseTime) * 1000;
          const clock = viewer!.clock;
          const speedFactor = Math.max(1, Math.abs(clock.multiplier));
          const ms = rawMs / (speedFactor * 9);
          const t = ((ms + phaseOffset) % totalPhaseTime) / totalPhaseTime;
          // 略小于 semiMajorAxis，避免浮点数误差导致 semiMajorAxis < semiMinorAxis 的异常
          const radius = 1000 + distance * 0.8 * t;
          return radius * 0.999999;
        }, false),
        height: height as any,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty((time: Cesium.JulianDate | undefined) => {
            if (!time) {
              return colorValue.withAlpha(0.15);
            }
            if (!baseTime) {
              baseTime = Cesium.JulianDate.clone(time);
            }
            const rawMs = Cesium.JulianDate.secondsDifference(time, baseTime) * 1000;
            const clock = viewer!.clock;
            const speedFactor = Math.max(1, Math.abs(clock.multiplier));
            const ms = rawMs / (speedFactor * 9);
            const t = ((ms + phaseOffset) % totalPhaseTime) / totalPhaseTime;
            const alpha = (1.0 - t) * 0.15;
            return colorValue.withAlpha(Math.max(0, alpha));
          }, false) as any
        ),
        outline: true,
        outlineColor: new Cesium.CallbackProperty((time: Cesium.JulianDate | undefined) => {
          if (!time) {
            return colorValue.withAlpha(1.0);
          }
          if (!baseTime) {
            baseTime = Cesium.JulianDate.clone(time);
          }
          const rawMs = Cesium.JulianDate.secondsDifference(time, baseTime) * 1000;
          const clock = viewer!.clock;
          const speedFactor = Math.max(1, Math.abs(clock.multiplier));
          const ms = rawMs / (speedFactor * 9);
          const t = ((ms + phaseOffset) % totalPhaseTime) / totalPhaseTime;
          const alpha = (1.0 - t);
          return colorValue.withAlpha(Math.max(0, alpha));
        }, false) as any,
        outlineWidth: 2
      }
    });
    if (rippleEntity) {
      registerSignalSourceEntity(rippleEntity);
    }
  }
}


/*信号交互——两个实体间距离小于给定公里数时，绘制虚线连接
 仅在传入的两个实体之间画线：signalSourceInteraction(e1, e2, 1000)
*/
export async function signalSourceInteraction(
  e1: Cesium.Entity,
  e2: Cesium.Entity,
  maxDistanceKm = 1000
): Promise<void> {
  if (!viewer) return;

  // 距离阈值（米）
  const km =
    typeof maxDistanceKm === "number" && Number.isFinite(maxDistanceKm) && maxDistanceKm > 0
      ? maxDistanceKm
      : 1000;
  const maxDistanceMeters = km * 1000;

  // 计算给定时间下实体位置
  const getPosAtTime = (
    entity: Cesium.Entity,
    time: Cesium.JulianDate
  ): Cesium.Cartesian3 | undefined => {
    const pos: any = (entity as any).position;
    if (!pos) return undefined;
    if (typeof pos.getValue === "function") {
      return pos.getValue(time) as Cesium.Cartesian3 | undefined;
    }
    return pos as Cesium.Cartesian3;
  };

  // 位置随时间变化：当距离小于阈值时返回两点，否则返回空数组（不绘制）
  const positionsProp = new Cesium.CallbackProperty(
    (time: Cesium.JulianDate | undefined) => {
      if (!viewer || !time) return [];

      const p1 = getPosAtTime(e1, time);
      const p2 = getPosAtTime(e2, time);
      if (!p1 || !p2) return [];

      const dist = Cesium.Cartesian3.distance(p1, p2);
      if (!isFinite(dist) || dist > maxDistanceMeters) {
        // 超出给定公里数：不绘制
        return [];
      }

      // 小于等于给定公里数：绘制虚线连接
      return [p1, p2];
    },
    false
  );

  const link = viewer.entities.add({
    name: "signal-source-link",
    polyline: {
      positions: positionsProp as any,
      width: 1,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.RED,
        // 加长每段的屏幕长度并加大间隔，使虚线效果更明显
        dashLength: 55,
        // 4 像素实线 + 12 像素空白（按位图案重复）
        dashPattern: 0b1111000000000000,
      }),
      clampToGround: false,
      arcType: Cesium.ArcType.GEODESIC,
    },
    properties: {
      signalSourceFlag: true,
      signalSourceType: "signalSource-link",
    } as any,
  });

  if (link) {
    registerSignalSourceEntity(link);
  }

  viewer.scene.requestRender();
}




/**
 * 读取星历文件txt,显示运动轨迹
 * @param options 星历文件参数
 * @returns 星历文件实体
 */
export interface ReadStarTrackParams {
  /**
   * TLE 文本来源：传入 txt 文件路径 / URL（例如 "/tle/star.txt"）
   */
  tleUrl: string;
  /**
   * 开始时间(北京时间)
   */
  startTime: Date;
  /**
   * 结束时间(北京时间)
   */
  endTime: Date;
  imgUrl: string; //贴图路径
  /** 轨道线颜色，默认红色 */
  color?: Cesium.Color | string;
}

/**
 * 读取双行根数星历文件txt,根据星历绘制卫星轨道,卫星实体静止
 * @param options 星历文件参数
 * @returns 星历文件实体
 */
export async function readStarTrack(options: ReadStarTrackParams): Promise<void> {
  if (!viewer) return;
  if (!options?.tleUrl) return;
  if (!options?.startTime || !options?.endTime) return;

  // 1) 读取 TLE 文本内容，并转为数组（去 BOM / trim / 过滤空行）
  const res = await fetch(options.tleUrl);
  if (!res.ok) return;
  const text = await res.text();
  const tleLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\uFEFF/, "").trim())
    .filter(Boolean);
  if (!tleLines.length) return;

  // 2) 从文件中解析多颗卫星：name + line1 + line2
  const tles: { name: string; line1: string; line2: string }[] = [];
  for (let i = 0; i < tleLines.length; i++) {
    const l = tleLines[i]!;
    if (!l.startsWith("1 ")) continue;
    const l2 = tleLines[i + 1];
    if (!l2 || !l2.startsWith("2 ")) continue;
    const prev = i - 1 >= 0 ? tleLines[i - 1]! : "";
    const name = prev && !prev.startsWith("1 ") && !prev.startsWith("2 ") ? prev : "SAT";
    tles.push({ name, line1: l, line2: l2 });
    i++; // skip line2
  }
  if (!tles.length) return;

// 3) 逐颗卫星计算 ECEF 采样点（按照传入的开始/结束时间生成整段星历）
  const results = await Promise.all(
    tles.map(async (t) => {
      const r = await calculateECEFRange({
        tleContent: [t.name, t.line1, t.line2],
        startTime: options.startTime,
        endTime: options.endTime,
      });
      return { satName: t.name || r.satName || "SAT", nowEcf: r.nowEcf };
    })
  );

  const satEphs = results
    .map((r) => ({
      satName: r.satName,
      orbitColor: options.color,
      ephs: r.nowEcf || [],
    }))
    .filter((s) => Array.isArray(s.ephs) && s.ephs.length >= 2);
  if (!satEphs.length) return;

  // 4) 绘制卫星轨道（圆环）+ 卫星点（静态）
  drawStarTrackByEphemeris({
    satEphs,
    imgUrl: options.imgUrl,
    tag: "star-track-from-tle",
  });
}

/*
  读取双行根数星历文件 txt，根据开始时间和结束时间生成星历采样点，
 然后调用 drawStarTrackAutoMotion 让卫星在该时间区间内按星历运动
（不绑定 Cesium 时钟，不循环）
 * @param options 星历文件参数
 * @returns 星历文件实体
*/
export async function readStarTrackAutoMotion(options: ReadStarTrackParams): Promise<void> {
  if (!viewer) return;
  if (!options?.tleUrl) return;
  if (!options?.startTime || !options?.endTime) return;

  // 1) 读取 TLE 文本内容，并转为数组（去 BOM / trim / 过滤空行）
  const res = await fetch(options.tleUrl);
  if (!res.ok) return;
  const text = await res.text();
  const tleLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\uFEFF/, "").trim())
    .filter(Boolean);
  if (!tleLines.length) return;

  // 2) 从文件中解析多颗卫星：name + line1 + line2
  const tles: { name: string; line1: string; line2: string }[] = [];
  for (let i = 0; i < tleLines.length; i++) {
    const l = tleLines[i]!;
    if (!l.startsWith("1 ")) continue;
    const l2 = tleLines[i + 1];
    if (!l2 || !l2.startsWith("2 ")) continue;
    const prev = i - 1 >= 0 ? tleLines[i - 1]! : "";
    const name = prev && !prev.startsWith("1 ") && !prev.startsWith("2 ") ? prev : "SAT";
    tles.push({ name, line1: l, line2: l2 });
    i++; // skip line2
  }
  if (!tles.length) return;

  // 3) 逐颗卫星计算 ECEF 采样点（1分钟间隔）
  const results = await Promise.all(
    tles.map(async (t) => {
      const r = await calculateECEFRange({
        tleContent: [t.name, t.line1, t.line2],
        startTime: options.startTime,
        endTime: options.endTime,
      });
      return { satName: t.name || r.satName || "SAT", nowEcf: r.nowEcf };
    })
  );

  const satEphs = results
    .map((r) => ({
      satName: r.satName,
      orbitColor: options.color,
      // calculateECEFRange 返回的 t 是毫秒时间戳，这里统一换算为“秒”，
      // 以匹配 drawStarTrackAutoMotion 中对 t(秒级) 的处理
      ephs: (r.nowEcf || []).map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        t: p.t / 1000,
      })),
    }))
    .filter((s) => Array.isArray(s.ephs) && s.ephs.length >= 2);
  if (!satEphs.length) return;

  // 4) 绘制卫星轨道（圆环）+ 卫星点（根据星历按秒级时间推进，不绑定 Cesium 时钟、不循环）
  drawStarTrackAutoMotion({
    satEphs,
    imgUrl: options.imgUrl,
    tag: "star-track-auto-from-tle",
  });
}



/**
 * 绘制卫星轨道参数
 * @param satEphs 卫星轨道参数
 * @param imgUrl 贴图路径
 * @param tag 绘制分组标识
 */
export interface StarEphemerisParams {
  satEphs: {
    satName: string;
     /** 轨道线颜色，默认红色 */
    orbitColor?: Cesium.Color | string;
    ephs: {
      x: number; //x坐标
      y: number; //y坐标
      z: number; //z坐标
      t: number; //时间戳(秒)
    }[];
  }[]; //卫星轨道参数
  imgUrl: string; //贴图路径
  /** 绘制分组标识：用于避免不同来源的星轨互相清理覆盖 */
  tag?: string;
}

/**
 * 根据星历绘制卫星轨道,卫星实体静止
 * @param options 卫星轨道参数
 * @returns 卫星轨道实体
 */
export async function drawStarTrackByEphemeris(
  options: StarEphemerisParams
): Promise<void> {
  if (!viewer) return;

  const tag = options?.tag || "star-track";
  const orbitType = `${tag}-orbit`;
  const satType = `${tag}-sat`;

  // 先清理旧的星轨（圆环/卫星点），避免重复叠加
  const toRemove: Cesium.Entity[] = [];
  const entities = viewer.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i] as Cesium.Entity;
    const props: any = e.properties;
    if (!props) continue;

    const typeProp = props.drawShapeType;
    const type =
      typeProp && typeof typeProp.getValue === "function"
        ? typeProp.getValue(viewer.clock.currentTime)
        : typeProp;
    if (type === orbitType || type === satType) {
      toRemove.push(e);
    }
  }
  toRemove.forEach((e) => viewer!.entities.remove(e));

  const CIRCLE_STEPS = 720;

  // 根据每颗卫星的 ephs（ECEF）绘制完整圆环
  for (const sat of options.satEphs || []) {
    const satName = sat?.satName || "";
    // 每颗卫星单独颜色（默认红色）
    const colorValue = sat?.orbitColor || Cesium.Color.RED;
    const orbitColor = (() => {
      if (typeof colorValue === "string") {
        const c = Cesium.Color.fromCssColorString(colorValue);
        return c || Cesium.Color.RED;
      }
      return colorValue;
    })();
    const ephsAny: any[] = (sat as any)?.ephs || [];
    if (!Array.isArray(ephsAny) || ephsAny.length < 2) continue;

    // 1) 输入点转 Cesium Cartesian3（m）
    const pts: Cesium.Cartesian3[] = [];
    for (const p of ephsAny) {
      if (!p) continue;
      const x = Number(p.x);
      const y = Number(p.y);
      const z = Number(p.z);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

      // 启发式：若数量级像 km（~7000），则转成 m；若像 m（~7e6），直接用
      const mag = Math.sqrt(x * x + y * y + z * z);
      const scale = mag > 0 && mag < 1e5 ? 1000 : 1;
      pts.push(new Cesium.Cartesian3(x * scale, y * scale, z * scale));
    }
    if (pts.length < 2) continue;

    // 2) 估算轨道平面法向量（ECEF）：累加相邻叉乘更稳
    let n = new Cesium.Cartesian3(0, 0, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const c = Cesium.Cartesian3.cross(a, b, new Cesium.Cartesian3());
      n = Cesium.Cartesian3.add(n, c, n);
    }
    let nMag = Cesium.Cartesian3.magnitude(n);
    if (!isFinite(nMag) || nMag < 1e-6) {
      // 兜底：用前两点叉乘
      n = Cesium.Cartesian3.cross(pts[0]!, pts[1]!, n);
      nMag = Cesium.Cartesian3.magnitude(n);
      if (!isFinite(nMag) || nMag < 1e-6) continue;
    }
    n = Cesium.Cartesian3.normalize(n, n);

    // 3) 确定圆环半径：用输入点平均半径
    let sum = 0;
    for (const p of pts) sum += Cesium.Cartesian3.magnitude(p);
    const radius = sum / pts.length;
    if (!isFinite(radius) || radius <= 0) continue;

    // 4) 构造平面内正交基 u/v：用第一个点投影到平面上
    const pickU = (p: Cesium.Cartesian3): Cesium.Cartesian3 | null => {
      const dot = Cesium.Cartesian3.dot(p, n);
      const proj = Cesium.Cartesian3.subtract(
        p,
        Cesium.Cartesian3.multiplyByScalar(n, dot, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const m = Cesium.Cartesian3.magnitude(proj);
      if (!isFinite(m) || m < 1e-6) return null;
      return Cesium.Cartesian3.normalize(proj, proj);
    };
    const uPick = pickU(pts[0]!) || pickU(pts[1]!);
    if (!uPick) continue;
    const u: Cesium.Cartesian3 = uPick;
    let v = Cesium.Cartesian3.cross(n, u, new Cesium.Cartesian3());
    v = Cesium.Cartesian3.normalize(v, v);

    // 5) 生成完整 360° 圆环（若输入弧段不完整，这里会自动补全整圈）
    const ringPositions: Cesium.Cartesian3[] = [];
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const theta = (i / CIRCLE_STEPS) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const p = Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(u, radius * cosT, new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(v, radius * sinT, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      ringPositions.push(p);
    }

    // 圆环实体
    viewer.entities.add({
      name: satName ? `${satName}-orbit` : "sat-orbit",
      properties: {
        drawShapeFlag: true,
        drawShapeType: orbitType,
      } as any,
      polyline: {
        positions: ringPositions,
        width: 1.5,
        material: orbitColor.withAlpha(0.9),
        clampToGround: false,
        // ECEF 空间点不要用 GEODESIC（贴地插值），否则可能出现不显示/异常插值
        arcType: Cesium.ArcType.NONE,
      },
    });

    // 卫星实体（静态：放在圆环起点）
    const satPos = ringPositions[0];
    if (!satPos) continue;
    viewer.entities.add({
      name: satName || "sat",
      properties: {
        drawShapeFlag: true,
        drawShapeType: satType,
      } as any,
      // 静态：固定在圆环起点
      position: satPos,
      billboard: {
        image: options.imgUrl,
        width: 32,
        height: 32,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      },
      label: satName
        ? {
            text: satName,
            font: "13px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -28),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
    });
  }

  viewer.scene.requestRender();
}

/**
 * 根据星历绘制卫星圆环轨道，受 Cesium 时钟/时间轴控制运动
 * @param options 星历文件参数
 * @returns 星历文件实体
 */
export async function drawStarTrackPlayMotion(
  options: StarEphemerisParams
): Promise<void> {
  if (!viewer) return;

  const tag = options?.tag || "star-track-auto";
  const orbitType = `${tag}-orbit`;
  const satType = `${tag}-sat`;

  // 1) 清理该 tag 旧实体（轨道 + 卫星）
  const toRemove: Cesium.Entity[] = [];
  const entities = viewer.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i] as Cesium.Entity;
    const props: any = e.properties;
    if (!props) continue;
    const typeProp = props.drawShapeType;
    const type =
      typeProp && typeof typeProp.getValue === "function"
        ? typeProp.getValue(viewer.clock.currentTime)
        : typeProp;
    if (type === orbitType || type === satType) {
      toRemove.push(e);
    }
  }
  toRemove.forEach((e) => viewer!.entities.remove(e));

  // 停止旧的自动运动循环
  const oldRaf = starTrackAutoMotionRafByTag.get(tag);
  if (typeof oldRaf === "number") {
    cancelAnimationFrame(oldRaf);
    starTrackAutoMotionRafByTag.delete(tag);
  }

  const CIRCLE_STEPS = 720;

  // 2) 遍历每一颗卫星：绘制圆环 + 准备运动轨迹
  for (const sat of options.satEphs || []) {
    const satName = sat?.satName || "";
    const colorValue = sat?.orbitColor || Cesium.Color.RED;
    const orbitColor =
      typeof colorValue === "string"
        ? Cesium.Color.fromCssColorString(colorValue) || Cesium.Color.RED
        : (colorValue as Cesium.Color);

    const ephsAny: any[] = (sat as any)?.ephs || [];
    if (!Array.isArray(ephsAny) || ephsAny.length < 2) continue;

    // 2.1 预处理星历：按时间戳（秒）排序、过滤非法值
    type EphPoint = { t: number; x: number; y: number; z: number };
    const ephsSorted: EphPoint[] = [...ephsAny]
      .map((p) => ({
        t: Number(p?.t),
        x: Number(p?.x),
        y: Number(p?.y),
        z: Number(p?.z),
      }))
      .filter((p) => isFinite(p.t) && isFinite(p.x) && isFinite(p.y) && isFinite(p.z))
      .sort((a, b) => a.t - b.t);
    if (ephsSorted.length < 2) continue;

    // 2.2 将星历点转成 Cartesian3（m），并根据这些点拟合一个圆环轨道
    const toMeters = (p: EphPoint): Cesium.Cartesian3 => {
      const mag = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      // 数量级像 km（~7000）则转成 m；像 m（~7e6）则直接用
      const scale = mag > 0 && mag < 1e5 ? 1000 : 1;
      return new Cesium.Cartesian3(p.x * scale, p.y * scale, p.z * scale);
    };

    const pts = ephsSorted.map(toMeters);
    if (pts.length < 2) continue;

    // 估算轨道平面法向量 n
    let n = new Cesium.Cartesian3(0, 0, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const c = Cesium.Cartesian3.cross(pts[i]!, pts[i + 1]!, new Cesium.Cartesian3());
      n = Cesium.Cartesian3.add(n, c, n);
    }
    let nMag = Cesium.Cartesian3.magnitude(n);
    if (!isFinite(nMag) || nMag < 1e-6) {
      n = Cesium.Cartesian3.cross(pts[0]!, pts[1]!, n);
      nMag = Cesium.Cartesian3.magnitude(n);
      if (!isFinite(nMag) || nMag < 1e-6) continue;
    }
    n = Cesium.Cartesian3.normalize(n, n);

    // 半径：星历点平均半径
    let sumR = 0;
    for (const p of pts) sumR += Cesium.Cartesian3.magnitude(p);
    const radius = sumR / pts.length;
    if (!isFinite(radius) || radius <= 0) continue;

    // 平面内正交基 u / v
    const pickU = (p: Cesium.Cartesian3): Cesium.Cartesian3 | null => {
      const dot = Cesium.Cartesian3.dot(p, n);
      const proj = Cesium.Cartesian3.subtract(
        p,
        Cesium.Cartesian3.multiplyByScalar(n, dot, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const m = Cesium.Cartesian3.magnitude(proj);
      if (!isFinite(m) || m < 1e-6) return null;
      return Cesium.Cartesian3.normalize(proj, proj);
    };
    const uPick = pickU(pts[0]!) || pickU(pts[1]!);
    if (!uPick) continue;
    const u = uPick;
    const v = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(n, u, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    const ringPositions: Cesium.Cartesian3[] = [];
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const theta = (i / CIRCLE_STEPS) * Math.PI * 2;
      ringPositions.push(
        Cesium.Cartesian3.add(
          Cesium.Cartesian3.multiplyByScalar(u, radius * Math.cos(theta), new Cesium.Cartesian3()),
          Cesium.Cartesian3.multiplyByScalar(v, radius * Math.sin(theta), new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        )
      );
    }

    // 绘制圆环轨道
    viewer.entities.add({
      name: satName ? `${satName}-orbit` : "sat-orbit",
      properties: {
        drawShapeFlag: true,
        drawShapeType: orbitType,
      } as any,
      polyline: {
        positions: ringPositions,
        width: 1.5,
        material: orbitColor.withAlpha(0.9),
        clampToGround: false,
        // ECEF 空间点不要用 GEODESIC（贴地插值），否则可能出现不显示/异常插值
        arcType: Cesium.ArcType.NONE,
      },
    });

    // 2.3 准备按时间戳（秒级）运动的轨迹（绑定 Cesium 时钟：由 currentTime / 时间轴驱动）
    const sampledPos = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.FIXED);
    for (const p of ephsSorted) {
      // t 为秒级时间戳，这里转成 ms，再转换为 JulianDate
      const jd = Cesium.JulianDate.fromDate(new Date(p.t * 1000));
      sampledPos.addSample(jd, toMeters(p));
    }
    sampledPos.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });

    const firstPos = toMeters(ephsSorted[0]!);
    const t0 = ephsSorted[0]!.t;
    const tN = ephsSorted[ephsSorted.length - 1]!.t;
    const t0Date = new Date(t0 * 1000);
    const tNDate = new Date(tN * 1000);
    const t0Julian = Cesium.JulianDate.fromDate(t0Date);
    const tNJulian = Cesium.JulianDate.fromDate(tNDate);

    // 由 Cesium 时钟 currentTime 决定卫星位置：拖动时间轴 / 播放暂停都会反映在实体位置上
    const posCb = new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
      if (!time) return firstPos;

      // 将当前时刻 clamp 到星历时间范围 [t0, tN]
      let clamped = time;
      if (Cesium.JulianDate.lessThan(time, t0Julian)) {
        clamped = t0Julian;
      } else if (Cesium.JulianDate.greaterThan(time, tNJulian)) {
        clamped = tNJulian;
      }

      const p = sampledPos.getValue(clamped);
      return (p as Cesium.Cartesian3) || firstPos;
    }, false);
    const satEntity = viewer.entities.add({
      name: satName || "SAT",
      properties: {
        drawShapeFlag: true,
        drawShapeType: satType,
      } as any,
      position: posCb as any,
      billboard: {
        image: options.imgUrl,
        width: 32,
        height: 32,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      },
      label: satName
        ? {
            text: satName,
            font: "13px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -28),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
    });

  }

  viewer.scene.requestRender();
}


/**
 * 根据星历绘制卫星圆环轨道，并按时间戳（秒级）驱动卫星实体运动（不绑定 Cesium 时钟，不循环）
 * @param options 星历文件参数
 * @returns 星历文件实体
 */
export async function drawStarTrackAutoMotion(
  options: StarEphemerisParams
): Promise<void> {
  if (!viewer) return;

  const tag = options?.tag || "star-track-auto";
  const orbitType = `${tag}-orbit`;
  const satType = `${tag}-sat`;

  // 1) 清理该 tag 旧实体（轨道 + 卫星）
  const toRemove: Cesium.Entity[] = [];
  const entities = viewer.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i] as Cesium.Entity;
    const props: any = e.properties;
    if (!props) continue;
    const typeProp = props.drawShapeType;
    const type =
      typeProp && typeof typeProp.getValue === "function"
        ? typeProp.getValue(viewer.clock.currentTime)
        : typeProp;
    if (type === orbitType || type === satType) {
      toRemove.push(e);
    }
  }
  toRemove.forEach((e) => viewer!.entities.remove(e));

  // 停止旧的自动运动循环
  const oldRaf = starTrackAutoMotionRafByTag.get(tag);
  if (typeof oldRaf === "number") {
    cancelAnimationFrame(oldRaf);
    starTrackAutoMotionRafByTag.delete(tag);
  }

  const CIRCLE_STEPS = 720;

  // 所有卫星共同的时间范围（秒）
  let globalT0 = Number.POSITIVE_INFINITY;
  let globalTN = Number.NEGATIVE_INFINITY;

  const movers: Array<{
    entity: Cesium.Entity;
    getPos: (tSec: number) => Cesium.Cartesian3;
    updateCurPos: (tSec: number) => void;
  }> = [];

  // 2) 遍历每一颗卫星：绘制圆环 + 准备运动轨迹
  for (const sat of options.satEphs || []) {
    const satName = sat?.satName || "";
    const colorValue = sat?.orbitColor || Cesium.Color.RED;
    const orbitColor =
      typeof colorValue === "string"
        ? Cesium.Color.fromCssColorString(colorValue) || Cesium.Color.RED
        : (colorValue as Cesium.Color);

    const ephsAny: any[] = (sat as any)?.ephs || [];
    if (!Array.isArray(ephsAny) || ephsAny.length < 2) continue;

    // 2.1 预处理星历：按时间戳（秒）排序、过滤非法值
    type EphPoint = { t: number; x: number; y: number; z: number };
    const ephsSorted: EphPoint[] = [...ephsAny]
      .map((p) => ({
        t: Number(p?.t),
        x: Number(p?.x),
        y: Number(p?.y),
        z: Number(p?.z),
      }))
      .filter((p) => isFinite(p.t) && isFinite(p.x) && isFinite(p.y) && isFinite(p.z))
      .sort((a, b) => a.t - b.t);
    if (ephsSorted.length < 2) continue;

    const t0 = ephsSorted[0]!.t;
    const tN = ephsSorted[ephsSorted.length - 1]!.t;
    if (isFinite(t0) && isFinite(tN) && tN > t0) {
      globalT0 = Math.min(globalT0, t0);
      globalTN = Math.max(globalTN, tN);
    }

    // 2.2 将星历点转成 Cartesian3（m），并根据这些点拟合一个圆环轨道
    const toMeters = (p: EphPoint): Cesium.Cartesian3 => {
      const mag = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      // 数量级像 km（~7000）则转成 m；像 m（~7e6）则直接用
      const scale = mag > 0 && mag < 1e5 ? 1000 : 1;
      return new Cesium.Cartesian3(p.x * scale, p.y * scale, p.z * scale);
    };

    const pts = ephsSorted.map(toMeters);
    if (pts.length < 2) continue;

    // 估算轨道平面法向量 n
    let n = new Cesium.Cartesian3(0, 0, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const c = Cesium.Cartesian3.cross(pts[i]!, pts[i + 1]!, new Cesium.Cartesian3());
      n = Cesium.Cartesian3.add(n, c, n);
    }
    let nMag = Cesium.Cartesian3.magnitude(n);
    if (!isFinite(nMag) || nMag < 1e-6) {
      n = Cesium.Cartesian3.cross(pts[0]!, pts[1]!, n);
      nMag = Cesium.Cartesian3.magnitude(n);
      if (!isFinite(nMag) || nMag < 1e-6) continue;
    }
    n = Cesium.Cartesian3.normalize(n, n);

    // 半径：星历点平均半径
    let sumR = 0;
    for (const p of pts) sumR += Cesium.Cartesian3.magnitude(p);
    const radius = sumR / pts.length;
    if (!isFinite(radius) || radius <= 0) continue;

    // 平面内正交基 u / v
    const pickU = (p: Cesium.Cartesian3): Cesium.Cartesian3 | null => {
      const dot = Cesium.Cartesian3.dot(p, n);
      const proj = Cesium.Cartesian3.subtract(
        p,
        Cesium.Cartesian3.multiplyByScalar(n, dot, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
      const m = Cesium.Cartesian3.magnitude(proj);
      if (!isFinite(m) || m < 1e-6) return null;
      return Cesium.Cartesian3.normalize(proj, proj);
    };
    const uPick = pickU(pts[0]!) || pickU(pts[1]!);
    if (!uPick) continue;
    const u = uPick;
    const v = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(n, u, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    const ringPositions: Cesium.Cartesian3[] = [];
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const theta = (i / CIRCLE_STEPS) * Math.PI * 2;
      ringPositions.push(
        Cesium.Cartesian3.add(
          Cesium.Cartesian3.multiplyByScalar(u, radius * Math.cos(theta), new Cesium.Cartesian3()),
          Cesium.Cartesian3.multiplyByScalar(v, radius * Math.sin(theta), new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        )
      );
    }

    // 绘制圆环轨道
    viewer.entities.add({
      name: satName ? `${satName}-orbit` : "sat-orbit",
      properties: {
        drawShapeFlag: true,
        drawShapeType: orbitType,
      } as any,
      polyline: {
        positions: ringPositions,
        width: 1.5,
        material: orbitColor.withAlpha(0.9),
        clampToGround: false,
        // ECEF 空间点不要用 GEODESIC（贴地插值），否则可能出现不显示/异常插值
        arcType: Cesium.ArcType.NONE,
      },
    });

    // 2.3 准备按时间戳（秒级）运动的轨迹（不绑定 Cesium 时钟）
    const sampledPos = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.FIXED);
    for (const p of ephsSorted) {
      // t 为秒级时间戳，这里转成 ms，再转换为 JulianDate
      const jd = Cesium.JulianDate.fromDate(new Date(p.t * 1000));
      sampledPos.addSample(jd, toMeters(p));
    }
    sampledPos.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });

    const firstPos = toMeters(ephsSorted[0]!);
    // 当前帧位置，由 CallbackProperty 读取；由 rAF 循环更新
    let curPos: Cesium.Cartesian3 = firstPos;
    const posCb = new Cesium.CallbackProperty(() => curPos, false);

    const satEntity = viewer.entities.add({
      name: satName || "SAT",
      properties: {
        drawShapeFlag: true,
        drawShapeType: satType,
      } as any,
      position: posCb as any,
      billboard: {
        image: options.imgUrl,
        width: 32,
        height: 32,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      },
      label: satName
        ? {
            text: satName,
            font: "13px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -28),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
    });

    movers.push({
      entity: satEntity,
      getPos: (tSec: number) => {
        const jd = Cesium.JulianDate.fromDate(new Date(tSec * 1000));
        return sampledPos.getValue(jd) || firstPos;
      },
      updateCurPos: (tSec: number) => {
        const jd = Cesium.JulianDate.fromDate(new Date(tSec * 1000));
        curPos = sampledPos.getValue(jd) || firstPos;
      },
    });
  }

  // 3) 不绑定 Cesium 时钟：内部用 requestAnimationFrame 按“星历秒级时间戳”推进到终点后停止
  if (movers.length && isFinite(globalT0) && isFinite(globalTN) && globalTN > globalT0) {
    const totalRangeSec = globalTN - globalT0; // 星历时间跨度（秒）
    const durationMs = totalRangeSec * 1000; // 1 秒星历 = 1 秒现实
    const startPerf = performance.now();

    const step = () => {
  if (!viewer) return;
      const elapsed = performance.now() - startPerf;
      const ratio = durationMs > 0 ? Math.min(elapsed / durationMs, 1) : 1;
      const curT = globalT0 + totalRangeSec * ratio;

      for (const m of movers) {
        m.updateCurPos(curT);
      }

      viewer.scene.requestRender();

      if (ratio >= 1) {
        starTrackAutoMotionRafByTag.delete(tag);
        return;
      }

      const raf = requestAnimationFrame(step);
      starTrackAutoMotionRafByTag.set(tag, raf);
    };

    const raf = requestAnimationFrame(step);
    starTrackAutoMotionRafByTag.set(tag, raf);
  }

  viewer.scene.requestRender();
}



/**
 * 计算某个时刻ECEF坐标系参数
 * @param options 计算ECEF参数
 * @returns 计算ECEF结果
 */
export interface CalculateECEFParams {
  /** 星历文件路径（与 tleContent 二选一） */
  tleUrl?: string;
  /** 直接传入 TLE 内容（数组形式），与 tleUrl 二选一 */
  tleContent?: string[];
  /** 指定时刻（北京时间），支持格式："2026-03-11 11:11:00"，不传则默认当前时间 */
  time?: Date | string;
}

/**
 * 某个时刻ECEF结果
 * @param satName 卫星名称
 * @param nowEcf 指定时刻的ECEF坐标系参数
 */
export interface CalculateECEFResult {
  satName: string;
  nowEcf: { x: number; y: number; z: number; t: number } | null;
}

/**
 * 计算某个时刻ECEF坐标系参数,并将结果返回
 * @param options 计算ECEF参数
 * @returns 计算ECEF结果
 */
export async function calculateECEF(options: CalculateECEFParams): Promise<CalculateECEFResult> {
  const { tleUrl, tleContent, time } = options;

  // 输入时间按北京时间(UTC+8)解释；satellite.js 使用 UTC 推进（Date 本身存储的是绝对时刻）
  const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;
  const parseBjTime = (t: Date | string | undefined): Date => {
    if (!t) return new Date();
    // Date 对象本身已是“绝对时刻”，这里直接使用；仅字符串需要按北京时间解析
    if (t instanceof Date) return t;
    if (typeof t !== "string") return new Date(NaN);

    // 支持格式："2026-03-11 11:11:00"（按 北京时间 解释）
    const m = t.trim().match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/
    );
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const hh = Number(m[4]);
      const mm = Number(m[5]);
      const ss = Number(m[6]);
      // 将北京时间转换为 UTC：UTC = BJ - 8h
      const ms = Date.UTC(y, mo - 1, d, hh, mm, ss) - BJ_OFFSET_MS;
      return new Date(ms);
    }

    // 兜底：尝试让 Date 自己解析（如 ISO-8601 字符串）
    return new Date(t);
  };

  const nowUtc = parseBjTime(time);

  const empty: CalculateECEFResult = { satName: "SAT", nowEcf: null };
  if ((!tleUrl || !String(tleUrl).trim()) && (!Array.isArray(tleContent) || tleContent.length === 0))
    return empty;
  if (!isFinite(nowUtc.getTime())) return empty;

  // 读取 TLE 文本（只取第一颗卫星）
  let lines: string[] = [];
  if (Array.isArray(tleContent) && tleContent.length > 0) {
    lines = tleContent
      .map((l) => String(l).replace(/^\uFEFF/, "").trim())
      .filter(Boolean);
  } else {
    const res = await fetch(String(tleUrl));
    if (!res.ok) return empty;
    const text = await res.text();
    lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\uFEFF/, "").trim())
      .filter(Boolean);
  }

  // 找到第一组 line1/line2；如果前一行不是 "1 " 则当作名称
  let satName = "SAT";
  let line1: string | undefined;
  let line2: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (l.startsWith("1 ") && i + 1 < lines.length && lines[i + 1]!.startsWith("2 ")) {
      line1 = l;
      line2 = lines[i + 1]!;
      const maybeName = i - 1 >= 0 ? lines[i - 1] : "";
      if (maybeName && !maybeName.startsWith("1 ") && !maybeName.startsWith("2 ")) satName = maybeName;
      break;
    }
  }
  if (!line1 || !line2) return empty;

  const satrec = satellite.twoline2satrec(line1, line2);

  const toEcfMeters = (d: Date) => {
    const pv = satellite.propagate(satrec, d);
    if (!pv?.position) return null;
    const gmst = satellite.gstime(d);
    const ecfKm = satellite.eciToEcf(pv.position, gmst);
    return { x: ecfKm.x * 1000, y: ecfKm.y * 1000, z: ecfKm.z * 1000, t: d.getTime() };
  };

  return { satName, nowEcf: toEcfMeters(nowUtc) };
}

/**
 * 计算一段时刻ECEF坐标系参数
 * @param options 计算ECEF参数
 * @returns 计算ECEF结果
 */
export interface CalculateECEFRangeParams {
  /** 星历文件路径（与 tleContent 二选一） */
  tleUrl?: string;
  /** 直接传入 TLE 内容（数组形式），与 tleUrl 二选一 */
  tleContent?: string[];
  /** 指定时刻（北京时间），支持格式："2026-03-11 11:11:00"，不传则默认当前时间 */
  startTime?: Date | string;
  endTime?: Date | string;
}

/**
 * 一段时刻ECEF结果
 * @param satName 卫星名称
 * @param nowEcf 一段时刻的ECEF坐标系参数
 */
export type CalculateECEFRangeResult = {
  /** 卫星名称（若 TLE 里带了名称行则返回；否则为 "SAT"） */
  satName: string;
  /** 一段时刻的ECEF坐标系参数 */
  nowEcf: { x: number; y: number; z: number; /** 时间戳（ms） */ t: number }[] | null;
};

/**
 * 计算一段时刻ECEF坐标系参数,并将结果返回,以startTime为开始时间,以endTime为结束时间
 * @param options 计算ECEF参数
 * @returns 计算ECEF结果
 */
export async function calculateECEFRange(options: CalculateECEFRangeParams): Promise<CalculateECEFRangeResult> {
  const { tleUrl, tleContent, startTime, endTime } = options;

  const empty: CalculateECEFRangeResult = { satName: "SAT", nowEcf: null };
  if ((!tleUrl || !String(tleUrl).trim()) && (!Array.isArray(tleContent) || tleContent.length === 0))
    return empty;

  const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;
  const parseBjTime = (t: Date | string | undefined): Date => {
    if (!t) return new Date();
    if (t instanceof Date) return t;
    if (typeof t !== "string") return new Date(NaN);

    // 支持格式："2026-03-11 11:11:00"（按 北京时间 解释）
    const m = t.trim().match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/
    );
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const hh = Number(m[4]);
      const mm = Number(m[5]);
      const ss = Number(m[6]);
      // 将北京时间转换为 UTC：UTC = BJ - 8h
      const ms = Date.UTC(y, mo - 1, d, hh, mm, ss) - BJ_OFFSET_MS;
      return new Date(ms);
    }

    // 兜底：尝试让 Date 自己解析（如 ISO-8601 字符串）
    return new Date(t);
  };

  const startUtc = parseBjTime(startTime);
  const endUtc = parseBjTime(endTime);
  if (!isFinite(startUtc.getTime()) || !isFinite(endUtc.getTime())) return empty;
  if (endUtc.getTime() < startUtc.getTime()) return empty;

  // 读取 TLE 文本（只取第一颗卫星）
  let lines: string[] = [];
  if (Array.isArray(tleContent) && tleContent.length > 0) {
    lines = tleContent
      .map((l) => String(l).replace(/^\uFEFF/, "").trim())
      .filter(Boolean);
  } else {
    const res = await fetch(String(tleUrl));
    if (!res.ok) return empty;
    const text = await res.text();
    lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\uFEFF/, "").trim())
      .filter(Boolean);
  }

  // 找到第一组 line1/line2；如果前一行不是 "1 " 则当作名称
  let satName = "SAT";
  let line1: string | undefined;
  let line2: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (l.startsWith("1 ") && i + 1 < lines.length && lines[i + 1]!.startsWith("2 ")) {
      line1 = l;
      line2 = lines[i + 1]!;
      const maybeName = i - 1 >= 0 ? lines[i - 1] : "";
      if (maybeName && !maybeName.startsWith("1 ") && !maybeName.startsWith("2 ")) satName = maybeName;
      break;
    }
  }
  if (!line1 || !line2) return empty;

  const satrec = satellite.twoline2satrec(line1, line2);
  const toEcfMeters = (d: Date) => {
    const pv = satellite.propagate(satrec, d);
    if (!pv?.position) return null;
    const gmst = satellite.gstime(d);
    const ecfKm = satellite.eciToEcf(pv.position, gmst);
    return { x: ecfKm.x * 1000, y: ecfKm.y * 1000, z: ecfKm.z * 1000, t: d.getTime() };
  };

  // 自适应采样步长：
  // - 短时间段保持 1 秒级精度；
  // - 时间段越长，自动增大步长，限制总采样点数量，提升计算性能。
  const durationMs = endUtc.getTime() - startUtc.getTime();
  if (durationMs <= 0) return empty;
  const BASE_STEP_MS = 1000; // 基础步长：1 秒
  const MAX_SAMPLES = 10000; // 单颗卫星最多采样点数上限
  // 先按 1 秒采样，如果点数会超过上限，则自动放大步长
  let STEP_MS = BASE_STEP_MS;
  const idealStepMs = durationMs / MAX_SAMPLES;
  if (idealStepMs > STEP_MS) {
    STEP_MS = Math.ceil(idealStepMs);
  }
  const points: { x: number; y: number; z: number; t: number }[] = [];

  for (let ms = startUtc.getTime(); ms <= endUtc.getTime(); ms += STEP_MS) {
    const p = toEcfMeters(new Date(ms));
    if (p) points.push(p);
  }
  const endP = toEcfMeters(endUtc);
  if (endP) {
    const lastT: number | undefined = points.length ? points[points.length - 1]!.t : undefined;
    if (endP.t !== lastT) points.push(endP);
  }

  return { satName, nowEcf: points };
}




/**
 * 手动绘制航迹结果类型
 * @param pointsDegrees 航迹点（经纬度）
 */
export type DrawVoyagePathResult = {
  pointsDegrees: { lon: number; lat: number; height: number }[]; // 航迹点（经纬度）
};

/**
 * 手动绘制航迹
 * @param options 航迹参数
 * @returns 航迹结果
 */
export function drawingVoyagePath(options?: {
  /** 预览航迹线颜色，默认红色 */
  color?: Cesium.Color | string;
}): Promise<DrawVoyagePathResult | null> {
  if (!viewer) return Promise.resolve(null);

  // 解析颜色参数，默认为红色
  const colorValue = options?.color || Cesium.Color.RED;
  const pathColor =
    typeof colorValue === "string"
      ? Cesium.Color.fromCssColorString(colorValue)
      : colorValue;

  // 航迹线高度：与当前选中实体（点位/图标）高度一致；取不到则回退为 0
  const getSelectedEntityHeight = (): number => {
    try {
      const e = selectedEntity.value as any;
      if (!e || !e.position) return 0;
      const time = viewer!.clock.currentTime;
      const pos: Cesium.Cartesian3 | undefined =
        typeof e.position?.getValue === "function" ? e.position.getValue(time) : e.position;
      if (!pos) return 0;
      return Cesium.Cartographic.fromCartesian(pos).height ?? 0;
    } catch {
      return 0;
    }
  };
  const PATH_HEIGHT = getSelectedEntityHeight();

  // 进入绘制模式
  isDrawingPath.value = true;
  drawingPathPoints.value = [];
  contextMenuVisible.value = false;

  // 创建临时路径实体用于预览，并打上标记，便于 clearDrawShapes 统一清除
  tempPathEntity = viewer.entities.add({
    properties: {
      drawShapeFlag: true,
      drawShapeType: "voyagePath",
    } as any,
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        // 至少两个点才显示线
        return drawingPathPoints.value.length > 1 ? drawingPathPoints.value : [];
      }, false),
      width: 1.2,
      material: pathColor.withAlpha(0.8),
    },
  });

  // 专用事件处理器：左键加点、右键结束
  const drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  // Promise 封装
  let resolved = false;
  let resolveResult: (value: DrawVoyagePathResult | null) => void = () => {};
  const done = (value: DrawVoyagePathResult | null) => {
    if (resolved) return;
    resolved = true;
    resolveResult(value);
  };

  // 左键点击添加点
  drawHandler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const cartesian = viewer!.camera.pickEllipsoid(
      click.position,
      viewer!.scene.globe.ellipsoid
    );
    if (cartesian) {
      // 默认为航迹线设置一个固定高度，避免 3D 模式下线贴地
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      carto.height = PATH_HEIGHT;
      const cartesianWithHeight = Cesium.Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        carto.height
      );
      drawingPathPoints.value.push(cartesianWithHeight);
      viewer!.scene.requestRender();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 结束绘制（右键或 ESC 调用）
  const endDrawing = () => {
    if (drawingPathPoints.value.length > 1 && tempPathEntity && tempPathEntity.polyline) {
      // 原始航迹点
      const rawPositions = drawingPathPoints.value.slice();
      const lastRaw = rawPositions[rawPositions.length - 1];

      // 使用 Catmull-Rom 样条对航迹进行插值，使航线连接更加平滑
      let finalPositions: Cesium.Cartesian3[] = rawPositions;
      if (rawPositions.length >= 3) {
        const times = rawPositions.map((_, i) => i);
        const spline = new Cesium.CatmullRomSpline({
          times,
          points: rawPositions,
        });

        const lastTime = times[times.length - 1] ?? 0;
        const samplePerSegment = 10; // 每段之间插值采样数，数值越大越平滑
        const step = 1 / samplePerSegment;

        finalPositions = [];
        for (let t = 0; t <= lastTime; t += step) {
          finalPositions.push(spline.evaluate(t));
        }
        // 确保一定包含最后时刻点（避免 step 导致末点丢失）
        if (finalPositions.length === 0 || lastTime - (Math.floor(lastTime / step) * step) > 1e-9) {
          finalPositions.push(spline.evaluate(lastTime));
        }
      }

      // 1) 确保最后一个点严格等于原始最后点（高度/位置都一致）
      if (lastRaw && finalPositions.length > 0) {
        finalPositions[finalPositions.length - 1] = lastRaw;
      }

      // 2) 将平滑后的所有点高度统一为 PATH_HEIGHT（与实体高度一致），避免插值带来高度漂移
      finalPositions = finalPositions.map((p) => {
        const c = Cesium.Cartographic.fromCartesian(p);
        c.height = PATH_HEIGHT;
        return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);
      });

      // 固定最终的（平滑后）航迹线位置数组，不再依赖 CallbackProperty
      (tempPathEntity.polyline as any).positions = finalPositions;
      // 成功生成一条新的航迹线之前，先删除之前已经固定下来的旧航迹线实体
      const toRemoveVoyage: Cesium.Entity[] = [];
      const entities = viewer!.entities.values;
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i] as Cesium.Entity;
        if (e === tempPathEntity) continue; // 保留当前这条新航迹
        const props: any = e.properties;
        if (!props) continue;

        const flagProp = props.drawShapeFlag;
        const typeProp = props.drawShapeType;

        const flag =
          flagProp && typeof flagProp.getValue === "function"
            ? flagProp.getValue(viewer!.clock.currentTime)
            : flagProp;
        const type =
          typeProp && typeof typeProp.getValue === "function"
            ? typeProp.getValue(viewer!.clock.currentTime)
            : typeProp;

        if (flag && type === "voyagePath") {
          toRemoveVoyage.push(e);
        }
      }
      toRemoveVoyage.forEach((ent) => viewer!.entities.remove(ent));

      // 保留当前这条新航迹（已固定 positions）
      tempPathEntity = null;

      // 手动绘制航迹成功后，将当前选中的实体（点位/图标）移动到第一个航迹点位置
      if (selectedEntity.value && drawingPathPoints.value.length > 0) {
        const firstPoint = drawingPathPoints.value[0];
        // 使用 ConstantPositionProperty（或直接赋值 Cartesian3）作为实体的位置属性
        // 方式一：显式创建 ConstantPositionProperty（类型最安全）
        // (selectedEntity.value as any).position = new Cesium.ConstantPositionProperty(firstPoint);
        // 方式二：直接赋值 Cartesian3，Cesium 内部会包装成 ConstantPositionProperty
        (selectedEntity.value as any).position = firstPoint;
      }

      // 计算经纬度坐标并通过 Promise 返回（使用平滑后的点）
      const pointsDegrees = finalPositions.map((p: Cesium.Cartesian3) => {
        const carto = Cesium.Cartographic.fromCartesian(p);
        return {
          lon: Cesium.Math.toDegrees(carto.longitude),
          lat: Cesium.Math.toDegrees(carto.latitude),
          height: carto.height,
        };
      });
      done({ pointsDegrees });
    } else if (tempPathEntity) {
      // 点数不足 2 个，不保留该线
      viewer!.entities.remove(tempPathEntity);
      tempPathEntity = null;
      done(null);
    }

    isDrawingPath.value = false;
    drawingPathPoints.value = [];
    drawHandler.destroy();
    viewer!.scene.requestRender();
  };

  // 右键结束绘制
  drawHandler.setInputAction(endDrawing, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // ESC 键结束绘制
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isDrawingPath.value) {
      // ESC 视为取消绘制，直接返回 null
      if (tempPathEntity) {
        viewer!.entities.remove(tempPathEntity);
        tempPathEntity = null;
      }
      isDrawingPath.value = false;
      drawingPathPoints.value = [];
      drawHandler.destroy();
      viewer!.scene.requestRender();
      done(null);
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
  return new Promise<DrawVoyagePathResult | null>((resolve) => {
    resolveResult = resolve;
  });
}




/**
 * 手动多边形绘制结果类型
 * @param pointsDegrees 顶点（经纬度）
 */
export type DrawPolygonResult = {
  pointsDegrees: { lng: number; lat: number; height: number }[]; // 顶点（经纬度）
};

/**
 * 手动绘制多边形
 * @param options 绘制选项：填充颜色、是否显示填充区域
 * @returns 多边形顶点（经纬度），取消则返回 null
 */
export function drawingPolygon(options?: {
  /** 填充颜色（以及边线颜色），默认红色 */
  fillColor?: Cesium.Color | string;
}): Promise<DrawPolygonResult | null> {
  if (!viewer) return Promise.resolve(null);
  const polygonPoints: Cesium.Cartesian3[] = [];
  // 关闭右键菜单，进入绘制模式
  contextMenuVisible.value = false;

  // 解析参数
  const fillColorValue = options?.fillColor || Cesium.Color.RED;
  const fillColor =
    typeof fillColorValue === "string"
      ? Cesium.Color.fromCssColorString(fillColorValue)
      : fillColorValue;
  // 计算一个“多边形内部”的显示点（简单用经纬度平均作为中心点，足够用于标签展示）
  const computeLabelPosition = (): Cesium.Cartesian3 | undefined => {
    if (polygonPoints.length < 3) return undefined;
    let sumLon = 0;
    let sumLat = 0;
    let sumH = 0;
    for (const p of polygonPoints) {
      const c = Cesium.Cartographic.fromCartesian(p);
      sumLon += c.longitude;
      sumLat += c.latitude;
      sumH += c.height || 0;
    }
    const n = polygonPoints.length;
    return Cesium.Cartesian3.fromRadians(sumLon / n, sumLat / n, sumH / n);
  };

  // 临时多边形实体用于预览（填充面）
  const tempPolygon = viewer.entities.add({
    // 打标签，便于统一清除
    properties: {
      drawShapeFlag: true,
      drawShapeType: "polygon",
    } as any,
    polygon: {
      hierarchy: new Cesium.CallbackProperty(() => {
        return polygonPoints.length >= 3
          ? new Cesium.PolygonHierarchy(polygonPoints)
          : undefined;
      }, false),
      material: fillColor.withAlpha(0.3),
      outline: true,
      outlineColor: fillColor,
      outlineWidth: 4,
    },
  });

  // 临时折线用于预览边（在选择第二个点时就显示第一条边）
  const tempPolyline = viewer.entities.add({
    properties: {
      drawShapeFlag: true,
      drawShapeType: "polygon-outline",
    } as any,
    polyline: {
      positions: new Cesium.CallbackProperty(() => {
        return polygonPoints.length >= 2 ? polygonPoints : [];
      }, false),
      width: 1,
      material: fillColor,
    },
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  let resolved = false;
  let resolveResult: (value: DrawPolygonResult | null) => void = () => {};
  const done = (value: DrawPolygonResult | null) => {
    if (resolved) return;
    resolved = true;
    resolveResult(value);
  };

  // 左键点击添加多边形顶点
  handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const cartesian = viewer!.camera.pickEllipsoid(
      click.position,
      viewer!.scene.globe.ellipsoid
    );
    if (cartesian) {
      polygonPoints.push(cartesian);
      viewer!.scene.requestRender();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  const finishDrawing = () => {
    // 顶点少于 3 个则删除临时多边形并返回 null
    if (polygonPoints.length < 3) {
      viewer!.entities.remove(tempPolygon);
      viewer!.entities.remove(tempPolyline);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
      return;
    }

    // 计算经纬度坐标
    const pointsDegrees = polygonPoints.map((p: Cesium.Cartesian3) => {
      const carto = Cesium.Cartographic.fromCartesian(p);
      return {
        lng: Cesium.Math.toDegrees(carto.longitude),
        lat: Cesium.Math.toDegrees(carto.latitude),
        height: carto.height,
      };
    });

    // 无论成功与否都移除临时折线
    viewer!.entities.remove(tempPolyline);

    handler.destroy();
    viewer!.scene.requestRender();

    done({
      pointsDegrees,
    });
  };

  // 右键结束绘制
  handler.setInputAction(finishDrawing, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // ESC 键结束绘制（视为取消）
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      viewer!.entities.remove(tempPolygon);
      viewer!.entities.remove(tempPolyline);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
 
  return new Promise<DrawPolygonResult | null>((resolve) => {
    resolveResult = resolve;
  });
}



// 手动扇形绘制结果类型
export type DrawSectorResult = {
  lng: number; // 扇形中心点经度（度）
  lat: number; // 扇形中心点纬度（度）
  height: number; // 扇形中心点高度（米）
  radius: number; // 半径（米）
  startAngle: number; // 起始角（度，相对于正北顺时针）
  endAngle: number; // 终止角（度，相对于正北顺时针）
  pointsDegrees: { lng: number; lat: number; height: number }[]; // 扇形边界多边形点
};

/**
 * 手动绘制扇形区域
 * 交互方式：
 *  1. 第一次左键：可以以任意点作为中心点，中心点颜色可以设置，默认红色
 *  2. 第二次左键：确定半径和起始边方向，起始边显示出来
 *  3. 第三次左键：确定终止边方向并完成扇形
 */
export function drawingSector(options?: { 
  centerColor?: Cesium.Color | string 
  fillColor?: Cesium.Color | string;
}): Promise<DrawSectorResult | null> {
  if (!viewer) {
    return Promise.resolve(null);
  }

  // 关闭右键菜单，进入绘制模式
  contextMenuVisible.value = false;

  // 解析中心点颜色，默认为红色
  const centerColorValue = options?.centerColor || Cesium.Color.RED;
  const centerColor = typeof centerColorValue === 'string' 
    ? Cesium.Color.fromCssColorString(centerColorValue) 
    : centerColorValue;

  // 解析区域填充颜色，默认为红色
  const fillColorValue = options?.fillColor || Cesium.Color.RED;
  const fillColor = typeof fillColorValue === "string"
    ? Cesium.Color.fromCssColorString(fillColorValue)
    : fillColorValue;

  // 扇形几何计算使用点击位置作为中心点
  let center: Cesium.Cartesian3 | undefined = undefined;
  let radius = 0;
  let startAngle = 0; // 弧度
  let endAngle = 0; // 弧度
  let hasCenter = false;
  let hasStart = false;
  let hasEnd = false;

  // ENU 坐标系（在确定中心后构建）
  let enuFrame: Cesium.Matrix4 | undefined = undefined;
  let invEnuFrame: Cesium.Matrix4 | undefined = undefined;

  // 中心点标记
  const centerPoint = viewer.entities.add({
    properties: {
      drawShapeFlag: true,
      drawShapeType: "sector",
    } as any,
    point: {
      show: new Cesium.CallbackProperty(() => hasCenter, false),
      pixelSize: 5,
      color: centerColor,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    position: new Cesium.CallbackProperty(() => center, false) as any,
  });

  // 起始边线（从中心到起始点，在确定中心后显示预览，确定起始边后显示实际边）
  const startEdge = viewer.entities.add({
    properties: {
      drawShapeFlag: true,
      drawShapeType: "sector",
    } as any,
    polyline: {
      show: new Cesium.CallbackProperty(() => hasCenter && !hasEnd, false),
      positions: new Cesium.CallbackProperty(() => {
        if (!center || !enuFrame) return [];
        const local = new Cesium.Cartesian3(
          radius * Math.sin(startAngle),
          radius * Math.cos(startAngle),
          0
        );
        const endPoint = Cesium.Matrix4.multiplyByPoint(
          enuFrame,
          local,
          new Cesium.Cartesian3()
        );
        return [center, endPoint];
      }, false),
      width: 1,
      material: centerColor,
    },
  });

  // 临时扇形实体用于预览（平面扇形，2D/3D 下都是同一平面）
  const tempSector = viewer.entities.add({
    properties: {
      drawShapeFlag: true,
      drawShapeType: "sector",
    } as any,
    polygon: {
      hierarchy: new Cesium.CallbackProperty(() => {
        if (!center || radius <= 0 || !hasStart || !hasEnd || !enuFrame) {
          return undefined;
        }

        const points = computeSectorPolygonPoints(
          center!,
          radius,
          startAngle,
          endAngle,
          enuFrame!
        );
        return points.length >= 3 ? new Cesium.PolygonHierarchy(points) : undefined;
      }, false),
      material: fillColor.withAlpha(0.3),
      outline: true,
      outlineColor: fillColor,
      outlineWidth: 3,
    },
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  let resolved = false;
  let resolveResult: (value: DrawSectorResult | null) => void = () => {};
  const done = (value: DrawSectorResult | null) => {
    if (resolved) return;
    resolved = true;
    resolveResult(value);
  };

  // 工具函数：将世界坐标转换到以中心为原点的 ENU 局部坐标
  const worldToLocal = (p: Cesium.Cartesian3): Cesium.Cartesian3 | null => {
    if (!invEnuFrame) return null;
    return Cesium.Matrix4.multiplyByPoint(invEnuFrame, p, new Cesium.Cartesian3());
  };

  // 工具函数：根据点计算相对中心的方位角（弧度），以正北为 0，顺时针为正方向
  const computeAngleFromCenter = (p: Cesium.Cartesian3): number | null => {
    const local = worldToLocal(p);
    if (!local) return null;
    // ENU: x=East, y=North
    const angle = Math.atan2(local.x, local.y); // [-PI, PI]
    return angle >= 0 ? angle : angle + 2 * Math.PI;
  };

  // 三次左键点击逻辑
  handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const cartesian = viewer!.camera.pickEllipsoid(
      click.position,
      viewer!.scene.globe.ellipsoid
    );
    if (!cartesian) return;

    if (!hasCenter) {
      // 第一次点击：设置中心点
      center = cartesian;
      hasCenter = true;
      // 构建 ENU 坐标系
      enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(center);
      invEnuFrame = Cesium.Matrix4.inverse(enuFrame, new Cesium.Matrix4());
    } else if (!hasStart) {
      // 第二次点击：确定半径和起始边方向
      if (!center || !invEnuFrame) return;
      radius = Cesium.Cartesian3.distance(center, cartesian);
      const ang = computeAngleFromCenter(cartesian);
      if (ang === null) return;
      startAngle = ang;
      endAngle = ang;
      hasStart = true;
      hasEnd = false;
    } else if (!hasEnd) {
      // 第三次点击：确定终止边方向并完成扇形
      if (!center || !invEnuFrame) return;
      const ang = computeAngleFromCenter(cartesian);
      if (ang === null) return;
      endAngle = ang;
      hasEnd = true;
      finishDrawing();
    }

    viewer!.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 鼠标移动时更新预览
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    const cartesian = viewer!.camera.pickEllipsoid(
      movement.endPosition,
      viewer!.scene.globe.ellipsoid
    );
    if (!cartesian) return;

    if (hasCenter && !hasStart) {
      // 有中心点但还没有起始边：更新半径和起始角预览
      if (!center || !invEnuFrame) return;
      radius = Cesium.Cartesian3.distance(center, cartesian);
      const ang = computeAngleFromCenter(cartesian);
      if (ang !== null) {
        startAngle = ang;
        endAngle = ang;
      }
    } else if (hasStart && !hasEnd) {
      // 有起始边但还没有终止边：更新终止角预览
      if (!center || !invEnuFrame) return;
      const ang = computeAngleFromCenter(cartesian);
      if (ang !== null) {
        endAngle = ang;
      }
    }

    viewer!.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  const finishDrawing = () => {
    if (!center || radius <= 0 || !hasStart || !hasEnd || !enuFrame) {
      viewer!.entities.remove(centerPoint);
      viewer!.entities.remove(startEdge);
      viewer!.entities.remove(tempSector);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
      return;
    }

    const polygonPoints = computeSectorPolygonPoints(
      center,
      radius,
      startAngle,
      endAngle,
      enuFrame
    );

    if (polygonPoints.length < 3) {
      viewer!.entities.remove(centerPoint);
      viewer!.entities.remove(startEdge);
      viewer!.entities.remove(tempSector);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
      return;
    }

    // 计算中心经纬度
    const centerCarto = Cesium.Cartographic.fromCartesian(center);
    const centerDegrees = {
      lng: Cesium.Math.toDegrees(centerCarto.longitude),
      lat: Cesium.Math.toDegrees(centerCarto.latitude),
      height: centerCarto.height,
    };

    // 计算扇形边界点的经纬度
    const pointsDegrees = polygonPoints.map((p: Cesium.Cartesian3) => {
      const c = Cesium.Cartographic.fromCartesian(p);
      return {
        lng: Cesium.Math.toDegrees(c.longitude),
        lat: Cesium.Math.toDegrees(c.latitude),
        height: c.height,
      };
    });

    // 清理临时实体（中心点、起始边、预览扇形）
    viewer!.entities.remove(centerPoint);
    viewer!.entities.remove(startEdge);
    handler.destroy();
    viewer!.scene.requestRender();

    done({
      lng: centerDegrees.lng,
      lat: centerDegrees.lat,
      height: centerDegrees.height,
      radius,
      startAngle: Cesium.Math.toDegrees(startAngle),
      endAngle: Cesium.Math.toDegrees(endAngle),
      pointsDegrees,
    });
  };

  // 右键结束绘制（若已选择终止角，则完成；否则取消）
  handler.setInputAction(() => {
    if (hasEnd) {
      finishDrawing();
  } else {
      // 取消绘制，清理所有临时实体
      viewer!.entities.remove(centerPoint);
      viewer!.entities.remove(startEdge);
      viewer!.entities.remove(tempSector);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
    }
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // ESC 键结束绘制（视为取消）
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      viewer!.entities.remove(centerPoint);
      viewer!.entities.remove(startEdge);
      viewer!.entities.remove(tempSector);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  return new Promise<DrawSectorResult | null>((resolve) => {
    resolveResult = resolve;
  });
}

/**
 * 根据中心点、半径、起始角和终止角，生成扇形多边形的顶点（Cartesian3）
 * 角度以正北为 0，顺时针为正方向，单位：弧度
 */
function computeSectorPolygonPoints(
  center: Cesium.Cartesian3,
  radius: number,
  startAngle: number,
  endAngle: number,
  enuFrame: Cesium.Matrix4
): Cesium.Cartesian3[] {
  const points: Cesium.Cartesian3[] = [];

  // 如果角度差为 0，则返回空
  let sweep = endAngle - startAngle;
  if (sweep === 0) {
    return points;
  }
  if (sweep < 0) {
    sweep += 2 * Math.PI;
  }

  const steps = 64;
  const step = sweep / steps;

  // 中心点
  points.push(center);

  // 从起始角到终止角按步长采样点（与中心同一高度的平面扇形）
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + step * i;

    // ENU: x=East, y=North，z=Up（此处 z 始终为 0，保持平面）
    const local = new Cesium.Cartesian3(
      radius * Math.sin(angle), // East
      radius * Math.cos(angle), // North
      0
    );
    const world = Cesium.Matrix4.multiplyByPoint(
      enuFrame,
      local,
      new Cesium.Cartesian3()
    );
    points.push(world);
  }

  return points;
}


// 手动绘制圆形区域返回结果类型
export type DrawCircleResult = {
  lng: number; // 中心点经度（度）
  lat: number; // 中心点纬度（度）
  height: number; // 中心点高度（米）
  radius: number; // 半径（米）
};

/**
 * 手动绘制圆形区域
 * 交互方式：
 *  1. 第一次左键：确定圆心（显示中心点）
 *  2. 第二次左键：确定半径并完成绘制（绘制中显示半径预览线段）
 * @param options 绘制选项：中心点颜色与填充颜色
 * @returns 中心点和半径，取消则返回 null
 */
export function drawingCircle(options?: {
  centerColor?: Cesium.Color | string;
  fillColor?: Cesium.Color | string;
}): Promise<DrawCircleResult | null> {
  if (!viewer) return Promise.resolve(null);

  // 关闭右键菜单，进入绘制模式
  contextMenuVisible.value = false;

  // 解析颜色参数，默认为红色
  const centerColorValue = options?.centerColor || Cesium.Color.RED;
  const centerColor =
    typeof centerColorValue === "string"
      ? Cesium.Color.fromCssColorString(centerColorValue)
      : centerColorValue;

  const fillColorValue = options?.fillColor || Cesium.Color.RED;
  const fillColor =
    typeof fillColorValue === "string"
      ? Cesium.Color.fromCssColorString(fillColorValue)
      : fillColorValue;

  let center: Cesium.Cartesian3 | undefined;
  let radius = 0;
  let currentMousePos: Cesium.Cartesian3 | undefined;

  // 临时圆形实体用于预览（在第一次确定圆心时创建）
  let tempCircle: Cesium.Entity | null = null;
  // 中心点标记
  let centerPoint: Cesium.Entity | null = null;
  // 半径预览线段（从中心到鼠标位置），在确定圆心后显示
  let radiusLine: Cesium.Entity | null = null;

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  let resolved = false;
  let resolveResult: (value: DrawCircleResult | null) => void = () => {};
  const done = (value: DrawCircleResult | null) => {
    if (resolved) return;
    resolved = true;
    resolveResult(value);
  };

  // 第一次左键：确定圆心
  handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const cartesian = viewer!.camera.pickEllipsoid(
      click.position,
      viewer!.scene.globe.ellipsoid
    );
    if (!cartesian) return;

    if (!center) {
      // 设置圆心并创建临时圆
      center = cartesian;

      // 创建中心点标记
      centerPoint = viewer!.entities.add({
        properties: {
          drawShapeFlag: true,
          drawShapeType: "circle",
        } as any,
        point: {
          pixelSize: 6,
          color: centerColor,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        position: center,
      });

      // 创建半径预览线段
      radiusLine = viewer!.entities.add({
        properties: {
          drawShapeFlag: true,
          drawShapeType: "circle",
        } as any,
        polyline: {
          show: new Cesium.CallbackProperty(
            () => !!center && !!currentMousePos,
            false
          ),
          positions: new Cesium.CallbackProperty(() => {
            if (!center || !currentMousePos) return [];
            return [center, currentMousePos];
          }, false),
          width: 1,
          material: centerColor,
        },
      });

      tempCircle = viewer!.entities.add({
        position: center,
        properties: {
          drawShapeFlag: true,
          drawShapeType: "circle",
        } as any,
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty(
            () => (radius > 0 ? radius : 1), // 给一个最小非零半径，避免 0 导致数值问题
            false
          ),
          semiMinorAxis: new Cesium.CallbackProperty(
            () => (radius > 0 ? radius : 1),
            false
          ),
          // 提高边界采样密度，让边缘更平滑
          granularity: Cesium.Math.RADIANS_PER_DEGREE * 0.2,
          material: fillColor.withAlpha(0.3),
          outline: true,
          outlineColor: fillColor,
          outlineWidth: 3,
        },
      });
    } else if (tempCircle) {
      // 第二次左键：直接确定半径并结束
      radius = Cesium.Cartesian3.distance(center, cartesian);
      finishDrawing();
    }
    viewer!.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 移动鼠标时更新半径（预览用）
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    if (!center || !tempCircle) return;
    const cartesian = viewer!.camera.pickEllipsoid(
      movement.endPosition,
      viewer!.scene.globe.ellipsoid
    );
    if (!cartesian) return;
    currentMousePos = cartesian;
    radius = Cesium.Cartesian3.distance(center, cartesian);
    viewer!.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  const finishDrawing = () => {
    // 如果没有有效的圆心或半径太小，则删除临时圆并返回 null
    if (!center || radius <= 0) {
      if (tempCircle) {
        viewer!.entities.remove(tempCircle);
      }
      if (centerPoint) viewer!.entities.remove(centerPoint);
      if (radiusLine) viewer!.entities.remove(radiusLine);
      done(null);
    } else {
      // 转换中心点为经纬度
      const cartographic = Cesium.Cartographic.fromCartesian(center);

      // 清理临时实体（中心点、半径线），保留最终圆
      if (centerPoint) viewer!.entities.remove(centerPoint);
      if (radiusLine) viewer!.entities.remove(radiusLine);
    
      done({
        lng: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        height: cartographic.height,
        radius,
      });
    }

    handler.destroy();
    viewer!.scene.requestRender();
  };

  // 右键结束绘制
  handler.setInputAction(finishDrawing, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // ESC 键结束绘制
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      finishDrawing();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  return new Promise<DrawCircleResult | null>((resolve) => {
    resolveResult = resolve;
  });
}



// 手动绘制椭圆形区域返回结果类型
export type DrawEllipseResult = {
  lng: number; // 中心点经度（度）
  lat: number; // 中心点纬度（度）
  height: number; // 中心点高度（米）
  semiMajor: number, // 长轴（米）
  semiMinor: number  // 短轴（米）
};

/**
 *  手动绘制椭圆形区域
 * 交互方式：
 *  1. 第一次左键：确定椭圆中心
 *  2. 第二次左键：确定长轴长度
 *  3. 第三次左键：确定短轴长度并完成扇形
 * @param options 绘制选项，包含中心点颜色和填充颜色
 * @returns 中心点和长短轴，取消则返回 null
 */
export function drawingEllipse(options?: { 
  centerColor?: Cesium.Color | string;
  fillColor?: Cesium.Color | string;
}): Promise<DrawEllipseResult | null> {
  if (!viewer) return Promise.resolve(null);

  // 关闭右键菜单，进入绘制模式
  contextMenuVisible.value = false;

  // 解析颜色参数，默认为红色
  const centerColorValue = options?.centerColor || Cesium.Color.RED;
  const centerColor = typeof centerColorValue === 'string' 
    ? Cesium.Color.fromCssColorString(centerColorValue) 
    : centerColorValue;
  
  const fillColorValue = options?.fillColor || Cesium.Color.RED;
  const fillColor = typeof fillColorValue === 'string' 
    ? Cesium.Color.fromCssColorString(fillColorValue) 
    : fillColorValue;

  let center: Cesium.Cartesian3 | undefined;
  let semiMajor = 0; // 长轴
  let semiMinor = 0; // 短轴
  let rotation = 0; // 椭圆旋转角度（弧度），从正北方向顺时针
  let currentMousePos: Cesium.Cartesian3 | undefined; // 当前鼠标位置，用于绘制轴预览
  let majorAxisEnd: Cesium.Cartesian3 | undefined; // 长轴终点位置
  let hasMajor = false; // 是否已确定长轴
  let hasMinor = false; // 是否已确定短轴

  // ENU 坐标系（在确定中心后构建）
  let enuFrame: Cesium.Matrix4 | undefined = undefined;
  let invEnuFrame: Cesium.Matrix4 | undefined = undefined;

  // 工具函数：将世界坐标转换到以中心为原点的 ENU 局部坐标
  const worldToLocal = (p: Cesium.Cartesian3): Cesium.Cartesian3 | null => {
    if (!invEnuFrame || !center) return null;
    return Cesium.Matrix4.multiplyByPoint(invEnuFrame, p, new Cesium.Cartesian3());
  };

  // 工具函数：根据点计算相对中心的方位角（弧度），以正北为 0，顺时针为正方向
  const computeAngleFromCenter = (p: Cesium.Cartesian3): number | null => {
    const local = worldToLocal(p);
    if (!local) return null;
    // ENU: x=East, y=North
    const angle = Math.atan2(local.x, local.y); // [-PI, PI]
    return angle >= 0 ? angle : angle + 2 * Math.PI;
  };

  // 工具函数：计算点在ENU坐标系中的水平距离（忽略高度差）
  const computeHorizontalDistance = (p: Cesium.Cartesian3): number | null => {
    const local = worldToLocal(p);
    if (!local) return null;
    // 只计算x-y平面上的距离，忽略z（高度）
    return Math.sqrt(local.x * local.x + local.y * local.y);
  };

  // 工具函数：计算点在ENU坐标系中东西方向的距离（只考虑x分量，即East方向）
  const computeEastWestDistance = (p: Cesium.Cartesian3): number | null => {
    const local = worldToLocal(p);
    if (!local) return null;
    // 只计算x分量（东西方向）的绝对值
    return Math.abs(local.x);
  };

  // 中心点标记
  let centerPoint: Cesium.Entity | null = null;
  // 长轴线（从中心到鼠标位置或长轴终点）
  let majorAxisLine: Cesium.Entity | null = null;
  // 短轴线（从中心到鼠标位置，在确定长轴后显示）
  let minorAxisLine: Cesium.Entity | null = null;
  // 临时椭圆实体用于预览（在确定中心后创建）
  let tempEllipse: Cesium.Entity | null = null;

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  let resolved = false;
  let resolveResult: (value: DrawEllipseResult | null) => void = () => {};
  const done = (value: DrawEllipseResult | null) => {
    if (resolved) return;
    resolved = true;
    resolveResult(value);
  };

  // 三次左键点击逻辑
  handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const cartesian = viewer!.camera.pickEllipsoid(
      click.position,
      viewer!.scene.globe.ellipsoid
    );
    if (!cartesian) return;

    if (!center) {
      // 第一次点击：设置中心点
      center = cartesian;
      
      // 构建 ENU 坐标系
      enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(center);
      invEnuFrame = Cesium.Matrix4.inverse(enuFrame, new Cesium.Matrix4());
      
      // 创建中心点标记
      centerPoint = viewer!.entities.add({
        properties: {
          drawShapeFlag: true,
          drawShapeType: "ellipse",
        } as any,
        point: {
          pixelSize: 6,
          color: centerColor,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        position: center,
      });

      // 创建长轴线（东西方向），只在确定中心后、确定长轴前显示
      majorAxisLine = viewer!.entities.add({
        properties: {
          drawShapeFlag: true,
          drawShapeType: "ellipse",
        } as any,
        polyline: {
          show: new Cesium.CallbackProperty(() => !!center && !hasMajor && !!currentMousePos, false),
          positions: new Cesium.CallbackProperty(() => {
            if (!center || !currentMousePos || !enuFrame) return [];
            const local = worldToLocal(currentMousePos);
            if (!local) return [];
            // 计算东西方向的距离（x分量）
            const eastDistance = local.x;
            // 创建东西方向的线：从中心向东或向西延伸
            const eastDirection = Cesium.Cartesian3.fromArray([1, 0, 0]); // ENU坐标系中的东方向
            const eastCartesian = Cesium.Matrix4.multiplyByPoint(
              enuFrame,
              Cesium.Cartesian3.multiplyByScalar(eastDirection, Math.abs(eastDistance), new Cesium.Cartesian3()),
              new Cesium.Cartesian3()
            );
            const westCartesian = Cesium.Matrix4.multiplyByPoint(
              enuFrame,
              Cesium.Cartesian3.multiplyByScalar(eastDirection, -Math.abs(eastDistance), new Cesium.Cartesian3()),
              new Cesium.Cartesian3()
            );
            return [westCartesian, center, eastCartesian];
          }, false),
          width: 1,
          material: centerColor,
        },
      });

      // 创建短轴线（从中心到鼠标位置），在确定长轴后显示
      minorAxisLine = viewer!.entities.add({
        properties: {
          drawShapeFlag: true,
          drawShapeType: "ellipse",
        } as any,
        polyline: {
          show: new Cesium.CallbackProperty(() => hasMajor && !hasMinor, false),
          positions: new Cesium.CallbackProperty(() => {
            if (!center || !currentMousePos) return [];
            return [center, currentMousePos];
          }, false),
          width: 1,
          material: centerColor,
        },
      });

      // 创建临时椭圆（只在确定长轴后显示）
      tempEllipse = viewer!.entities.add({
        position: center,
        properties: {
          drawShapeFlag: true,
          drawShapeType: "ellipse",
        } as any,
        ellipse: {
          show: new Cesium.CallbackProperty(() => hasMajor, false),
          semiMajorAxis: new Cesium.CallbackProperty(
            () => (semiMajor > 0 ? semiMajor : 1),
            false
          ),
          semiMinorAxis: new Cesium.CallbackProperty(
            () => (semiMinor > 0 ? semiMinor : 1),
            false
          ),
          rotation: new Cesium.CallbackProperty(() => rotation, false),
          // 提高椭圆边界采样密度，让边缘更平滑（granularity 越小越平滑）
          granularity: Cesium.Math.RADIANS_PER_DEGREE * 0.2,
          height: new Cesium.CallbackProperty(() => {
            if (!center) return 0;
            const carto = Cesium.Cartographic.fromCartesian(center);
            return carto.height;
          }, false),
          material: fillColor.withAlpha(0.3),
          outline: true,
          outlineColor: fillColor,
          outlineWidth: 3,
        },
      });
    } else if (!hasMajor) {
      // 第二次左键：确定长轴长度（使用东西方向距离）
      const dist = computeEastWestDistance(cartesian);
      if (dist === null) return;
      semiMajor = dist;
      hasMajor = true;
      // 长轴方向固定为东西方向（Cesium EllipseGraphics.rotation 的基准与我们预期不同）
      // 这里固定为 0，可确保长轴为东西方向、短轴为南北方向
      rotation = 0;
      // 设置默认短轴预览
      if (semiMinor <= 0) {
        semiMinor = semiMajor * 0.6;
      }
    } else if (!hasMinor) {
      // 第三次左键：确定短轴长度并完成绘制（使用水平距离）
      const dist = computeHorizontalDistance(cartesian);
      if (dist === null) return;
      semiMinor = dist;
      hasMinor = true;
      // 确保短轴不大于长轴（长轴固定东西方向，不做交换）
      if (semiMinor > semiMajor) semiMinor = semiMajor;
      finishDrawing();
    }

    viewer!.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 鼠标移动：更新长轴预览和短轴预览
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    const cartesian = viewer!.camera.pickEllipsoid(
      movement.endPosition,
      viewer!.scene.globe.ellipsoid
    );
    if (!cartesian) return;

    if (!center) return;

    // 更新当前鼠标位置，用于轴预览
    currentMousePos = cartesian;

    if (!tempEllipse) return;

    if (!hasMajor) {
      // 还没有确定长轴，用鼠标东西方向距离作为长轴预览（仅用于预览线，不显示椭圆）
      const dist = computeEastWestDistance(cartesian);
      if (dist !== null) {
        semiMajor = dist;
        // 长轴方向固定为东西方向
        rotation = 0;
        if (semiMinor <= 0) {
          semiMinor = semiMajor * 0.6; // 默认短轴为长轴的 60%
        }
      }
    } else if (!hasMinor) {
      // 已经确定长轴，但还没确定短轴，用鼠标水平距离作为短轴预览
      const dist = computeHorizontalDistance(cartesian);
      if (dist !== null) {
        semiMinor = dist;
        // 短轴不能大于长轴，如果大于则限制为长轴
        if (semiMinor > semiMajor) {
          semiMinor = semiMajor;
        }
      }
    }

    viewer!.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  const finishDrawing = () => {
    const ok = !!center && !!tempEllipse && hasMajor && hasMinor && semiMajor > 0 && semiMinor > 0;

    if (!ok) {
      // 清理所有临时实体
      if (centerPoint) viewer!.entities.remove(centerPoint);
      if (majorAxisLine) viewer!.entities.remove(majorAxisLine);
      if (minorAxisLine) viewer!.entities.remove(minorAxisLine);
      if (tempEllipse) viewer!.entities.remove(tempEllipse);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
      return;
    }

    // 计算中心点经纬度（度）
    const carto = Cesium.Cartographic.fromCartesian(center!);
   
    // 清理临时实体（中心点、长轴线、短轴线），保留最终椭圆
    if (centerPoint) viewer!.entities.remove(centerPoint);
    if (majorAxisLine) viewer!.entities.remove(majorAxisLine);
    if (minorAxisLine) viewer!.entities.remove(minorAxisLine);
    handler.destroy();
    viewer!.scene.requestRender();
    done({
      lng: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height,
      semiMajor,
      semiMinor,
    });
  };

  // 右键结束绘制
  handler.setInputAction(finishDrawing, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // ESC 结束绘制（视为取消：会返回 null）
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // 清理所有临时实体
      if (centerPoint) viewer!.entities.remove(centerPoint);
      if (majorAxisLine) viewer!.entities.remove(majorAxisLine);
      if (minorAxisLine) viewer!.entities.remove(minorAxisLine);
      if (tempEllipse) viewer!.entities.remove(tempEllipse);
      handler.destroy();
      viewer!.scene.requestRender();
      done(null);
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  return new Promise<DrawEllipseResult | null>((resolve) => {
    resolveResult = resolve;
  });
}





// 绘制多边形区域参数类
export interface DrawPolygonParams {
  points: { lng: number; lat: number; height?: number }[]; // 多边形顶点（经纬度）
  material?: Cesium.MaterialProperty | Cesium.Color | string; // 填充材质/颜色，支持 RGB 字符串格式（如 "rgb(255, 64, 84)"），默认 DARKMAGENTA
  outlineColor?: Cesium.Color | string; // 描边颜色，支持 RGB 字符串格式（如 "#ff4054"），默认 DARKMAGENTA
  outlineWidth?: number; // 描边宽度，默认 3
  alpha?: number; // 填充区域透明度（0-1），默认 0.3
  height?: number; // 高度（米），默认 0
  extrudedHeight?: number; // 拉伸高度（米），可选
  /** 区域描述文本（显示在多边形内部）；不传/空字符串则不显示 */
  description?: string;
  /** 描述文字颜色，默认白色 */
  descriptionColor?: Cesium.Color | string;
  /** 区域描述字体大小（px），默认 16 */
  descriptionFontSize?: number;
}

/**
 * 根据参数在地图上绘制多边形区域
 * @param options 多边形参数
 */
export function drawPolygonByParams(
  options: DrawPolygonParams
) {
  if (!viewer) return;

  const {
    points,
    material,
    outlineColor,
    outlineWidth = 3,
    alpha = 0.3,
    height = 0,
    extrudedHeight,
    description,
    descriptionColor,
    descriptionFontSize = 16,
  } = options;

  // 验证点数组
  if (!points || points.length < 3) {
    console.warn("drawPolygonByParams: 至少需要3个点才能绘制多边形");
    return;
  }

  // 处理填充材质/颜色
  let finalMaterial: Cesium.MaterialProperty | Cesium.Color;
  if (typeof material === "string") {
    // RGB 字符串格式，应用透明度
    finalMaterial = Cesium.Color.fromCssColorString(material).withAlpha(alpha);
  } else if (material instanceof Cesium.Color) {
    // Cesium.Color 对象，应用透明度
    finalMaterial = material.withAlpha(alpha);
  } else if (material) {
    // MaterialProperty，直接使用
    finalMaterial = material;
  } else {
    // 默认颜色
    finalMaterial = Cesium.Color.DARKMAGENTA.withAlpha(alpha);
  }

  // 处理描边颜色
  let finalOutlineColor: Cesium.Color;
  if (typeof outlineColor === "string") {
    // RGB 字符串格式
    finalOutlineColor = Cesium.Color.fromCssColorString(outlineColor);
  } else if (outlineColor) {
    // Cesium.Color 对象
    finalOutlineColor = outlineColor;
  } else {
    // 默认颜色
    finalOutlineColor = Cesium.Color.DARKMAGENTA;
  }

  // 将经纬度转换为笛卡尔坐标
  const cartesianPoints = points.map((point) => {
    return Cesium.Cartesian3.fromDegrees(
      point.lng,
      point.lat,
      point.height ?? height
    );
  });

  // 处理描述文字
  const descriptionText = (description ?? "").trim();
  const descriptionColorValue = descriptionColor || Cesium.Color.WHITE;
  const finalDescriptionColor =
    typeof descriptionColorValue === "string"
      ? Cesium.Color.fromCssColorString(descriptionColorValue)
      : descriptionColorValue;
  const fontSizePx =
    Number.isFinite(descriptionFontSize) && descriptionFontSize! > 0
      ? descriptionFontSize
      : 16;

  // 创建多边形实体
  viewer.entities.add({
    properties: {
      drawShapeFlag: true,
      drawShapeType: "polygon",
    } as any,
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(cartesianPoints),
      material: finalMaterial,
      outline: true,
      outlineColor: finalOutlineColor,
      outlineWidth: outlineWidth,
      height: height,
      extrudedHeight: extrudedHeight,
    },
  });

  // 区域描述文本：显示在多边形中心
  if (descriptionText) {
    const centerCartesian = Cesium.BoundingSphere.fromPoints(cartesianPoints).center;
    viewer.entities.add({
      properties: {
        drawShapeFlag: true,
        drawShapeType: "polygon-label",
      } as any,
      position: centerCartesian,
      label: {
        text: descriptionText,
        fillColor: finalDescriptionColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        font: `${fontSizePx}px sans-serif`,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  viewer.scene.requestRender();
}



// 绘制椭圆形区域参数 
export interface DrawEllipseParams {
  center: Cesium.Cartesian3 | { lng: number; lat: number; height?: number }; // 中心点（笛卡尔或经纬度）
  semiMajor: number; // 长轴（米）
  semiMinor: number; // 短轴（米）
  material?: Cesium.MaterialProperty | Cesium.Color | string; // 填充材质/颜色，支持 RGB 字符串格式（如 "rgb(255, 64, 84)"），默认 DARKMAGENTA
  outlineColor?: Cesium.Color | string; // 描边颜色，支持 RGB 字符串格式（如 "rgb(255, 64, 84)"），默认 DARKMAGENTA
  outlineWidth?: number; // 描边宽度，默认 3
  alpha?: number; // 填充区域透明度（0-1），默认 0.3
  rotation?: number; // 旋转角度（弧度），默认 0
  height?: number; // 高度（米），默认 0
  extrudedHeight?: number; // 拉伸高度（米），可选
   /** 区域描述文本（显示在多边形内部）；不传/空字符串则不显示 */
   description?: string;
   /** 描述文字颜色，默认白色 */
   descriptionColor?: Cesium.Color | string;
   /** 区域描述字体大小（px），默认 16 */
   descriptionFontSize?: number;
}

/**
 * 根据参数在地图上绘制椭圆形区域
 * @param options 椭圆形参数
 */
export function drawEllipseByParams(
  options: DrawEllipseParams
) {
  if (!viewer) return null;

  const {
    center,
    semiMajor,
    semiMinor,
    material,
    outlineColor,
    outlineWidth = 3,
    alpha = 0.3,
    rotation = 0,
    height = 0,
    extrudedHeight,
    description,
    descriptionColor,
    descriptionFontSize = 16,
  } = options;

  // 转换中心点为笛卡尔坐标
  let centerCartesian: Cesium.Cartesian3;
  if (center instanceof Cesium.Cartesian3) {
    centerCartesian = center;
  } else {
    centerCartesian = Cesium.Cartesian3.fromDegrees(
      center.lng,
      center.lat,
      center.height ?? height
    );
  }

  // 处理填充材质/颜色
  let finalMaterial: Cesium.MaterialProperty | Cesium.Color;
  if (typeof material === "string") {
    // RGB 字符串格式，应用透明度
    finalMaterial = Cesium.Color.fromCssColorString(material).withAlpha(alpha);
  } else if (material instanceof Cesium.Color) {
    // Cesium.Color 对象，应用透明度
    finalMaterial = material.withAlpha(alpha);
  } else if (material) {
    // MaterialProperty，直接使用
    finalMaterial = material;
  } else {
    // 默认颜色
    finalMaterial = Cesium.Color.DARKMAGENTA.withAlpha(alpha);
  }

  // 处理描边颜色
  let finalOutlineColor: Cesium.Color;
  if (typeof outlineColor === "string") {
    // RGB 字符串格式
    finalOutlineColor = Cesium.Color.fromCssColorString(outlineColor);
  } else if (outlineColor) {
    // Cesium.Color 对象
    finalOutlineColor = outlineColor;
  } else {
    // 默认颜色
    finalOutlineColor = Cesium.Color.DARKMAGENTA;
  }

  // 处理描述文字
  const descriptionText = (description ?? "").trim();
  const descriptionColorValue = descriptionColor || Cesium.Color.WHITE;
  const finalDescriptionColor =
    typeof descriptionColorValue === "string"
      ? Cesium.Color.fromCssColorString(descriptionColorValue)
      : descriptionColorValue;
  const fontSizePx =
    Number.isFinite(descriptionFontSize) && descriptionFontSize! > 0
      ? descriptionFontSize
      : 16;

  // 绘制椭圆
  viewer.entities.add({
    position: centerCartesian,
    properties: {
      drawShapeFlag: true,
      drawShapeType: "ellipse",
    } as any,
    ellipse: {
      semiMajorAxis: semiMajor,
      semiMinorAxis: semiMinor,
      material: finalMaterial,
      outline: true,
      outlineColor: finalOutlineColor,
      outlineWidth: outlineWidth,
      rotation: rotation,
      // 提高椭圆边界采样密度，让边缘更平滑（granularity 越小越平滑）
      granularity: Cesium.Math.RADIANS_PER_DEGREE * 0.2,
      height: height,
      extrudedHeight: extrudedHeight,
    },
  });

  // 区域描述文本：显示在椭圆中心
  if (descriptionText) {
    viewer.entities.add({
      properties: {
        drawShapeFlag: true,
        drawShapeType: "ellipse-label",
      } as any,
      position: centerCartesian,
      label: {
        text: descriptionText,
        fillColor: finalDescriptionColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        font: `${fontSizePx}px sans-serif`,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  viewer.scene.requestRender();
}



// 绘制圆形区域参数 
export interface DrawCircleParams {
  center: Cesium.Cartesian3 | { lng: number; lat: number; height?: number }; // 圆心（笛卡尔或经纬度）
  radius: number; // 半径（米）
  material?: Cesium.MaterialProperty | Cesium.Color | string; // 填充材质/颜色，支持 RGB 字符串格式（如 "rgb(255, 64, 84)"）
  outlineColor?: Cesium.Color | string; // 描边颜色，支持 RGB 字符串格式（如 "rgb(255, 64, 84)"）
  outlineWidth?: number; // 描边宽度，默认 3
  alpha?: number; // 填充区域透明度（0-1），默认 0.3
  height?: number; // 高度（米），默认 0
  extrudedHeight?: number; // 拉伸高度（米），可选
  /** 区域描述文本（显示在多边形内部）；不传/空字符串则不显示 */
  description?: string;
  /** 描述文字颜色，默认白色 */
  descriptionColor?: Cesium.Color | string;
  /** 区域描述字体大小（px），默认 16 */
  descriptionFontSize?: number;
  /** 额外属性：会合并到圆形实体的 properties 中（用于作战范围等统一控制） */
  properties?: Record<string, any>;
  /** 额外属性：会合并到 label 实体的 properties 中 */
  labelProperties?: Record<string, any>;
}

/**
 * 根据参数在地图上绘制圆形区域
 * @param options 圆形参数
 */
export function drawCircleByParams(options: DrawCircleParams): Cesium.Entity | null {
  if (!viewer) return null;

  const {
    center,
    radius,
    material,
    outlineColor,
    outlineWidth = 3,
    alpha = 0.3,
    height = 0,
    extrudedHeight,
    description,
    descriptionColor,
    descriptionFontSize = 16,
    properties,
    labelProperties,
  } = options;

  // 半径必须为正数
  if (!radius || radius <= 0) {
    console.warn("drawCircleByParams: radius 必须大于 0");
    return null;
  }

  // 转换圆心为笛卡尔坐标
  let centerCartesian: Cesium.Cartesian3;
  if (center instanceof Cesium.Cartesian3) {
    centerCartesian = center;
  } else {
    centerCartesian = Cesium.Cartesian3.fromDegrees(
      center.lng,
      center.lat,
      center.height ?? height
    );
  }

  // 处理填充材质/颜色
  let finalMaterial: Cesium.MaterialProperty | Cesium.Color;
  if (typeof material === "string") {
    // RGB 字符串格式，应用透明度
    finalMaterial = Cesium.Color.fromCssColorString(material).withAlpha(alpha);
  } else if (material instanceof Cesium.Color) {
    // Cesium.Color 对象，应用透明度
    finalMaterial = material.withAlpha(alpha);
  } else if (material) {
    // MaterialProperty，直接使用
    finalMaterial = material;
  } else {
    // 默认颜色
    finalMaterial = Cesium.Color.DARKMAGENTA.withAlpha(alpha);
  }

  // 处理描边颜色
  let finalOutlineColor: Cesium.Color;
  if (typeof outlineColor === "string") {
    // RGB 字符串格式
    finalOutlineColor = Cesium.Color.fromCssColorString(outlineColor);
  } else if (outlineColor) {
    // Cesium.Color 对象
    finalOutlineColor = outlineColor;
  } else {
    // 默认颜色
    finalOutlineColor = Cesium.Color.DARKMAGENTA;
  }

  // 处理描述文字
  const descriptionText = (description ?? "").trim();
  const descriptionColorValue = descriptionColor || Cesium.Color.WHITE;
  const finalDescriptionColor =
    typeof descriptionColorValue === "string"
      ? Cesium.Color.fromCssColorString(descriptionColorValue)
      : descriptionColorValue;
  const fontSizePx =
    Number.isFinite(descriptionFontSize) && descriptionFontSize! > 0
      ? descriptionFontSize
      : 16;

  // 绘制圆形（使用等长短轴的椭圆实现）
  const circleEntity = viewer.entities.add({
    position: centerCartesian,
    properties: {
      drawShapeFlag: true,
      drawShapeType: "circle",
      ...(properties || {}),
    } as any,
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      material: finalMaterial,
      outline: true,
      outlineColor: finalOutlineColor,
      outlineWidth: outlineWidth,
      height: height,
      extrudedHeight: extrudedHeight,
    },
  });

  // 区域描述文本：显示在圆形中心
  if (descriptionText) {
    viewer.entities.add({
      properties: {
        drawShapeFlag: true,
        drawShapeType: "circle-label",
        ...(labelProperties || {}),
      } as any,
      position: centerCartesian,
      label: {
        text: descriptionText,
        fillColor: finalDescriptionColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        font: `${fontSizePx}px sans-serif`,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  viewer.scene.requestRender();
  return circleEntity;
}



// 绘制扇形区域参数
export interface DrawSectorParams {
  center: Cesium.Cartesian3 | { lng: number; lat: number; height?: number }; // 扇形中心点（笛卡尔或经纬度）
  radius: number; // 半径（米）
  startAngle: number; // 起始角（度，相对于正北顺时针）
  endAngle: number; // 终止角（度，相对于正北顺时针）
  material?: Cesium.MaterialProperty | Cesium.Color | string; // 填充材质/颜色，支持 RGB 字符串格式
  outlineColor?: Cesium.Color | string; // 描边颜色，支持 RGB 字符串格式
  outlineWidth?: number; // 描边宽度，默认 3
  alpha?: number; // 填充区域透明度（0-1），默认 0.3
  height?: number; // 高度（米），默认 0
  extrudedHeight?: number; // 拉伸高度（米），可选
  /** 区域描述文本（显示在多边形内部）；不传/空字符串则不显示 */
  description?: string;
  /** 描述文字颜色，默认白色 */
  descriptionColor?: Cesium.Color | string;
  /** 区域描述字体大小（px），默认 16 */
  descriptionFontSize?: number;
}
/**
 * 根据参数在地图上绘制扇形区域（以给定中心点为圆心，startAngle/endAngle 为方位角）
 * 角度约定：0° 为正北，顺时针为正方向（与交互绘制扇形保持一致）
 */
export function drawSectorByParams(options: DrawSectorParams) {
  if (!viewer) return null;

  const {
    center,
    radius,
    startAngle,
    endAngle,
    material,
    outlineColor,
    outlineWidth = 3,
    alpha = 0.3,
    height = 0,
    extrudedHeight,
    description,
    descriptionColor,
    descriptionFontSize = 16,
  } = options;

  // 半径必须为正数
  if (!radius || radius <= 0) {
    console.warn("drawSectorByParams: radius 必须大于 0");
    return null;
  }

  // 若起始角和终止角相同，则无法形成扇形
  if (startAngle === endAngle) {
    console.warn("drawSectorByParams: startAngle 与 endAngle 相同，无法绘制扇形");
    return null;
  }

  // 转换中心点为笛卡尔坐标
  let centerCartesian: Cesium.Cartesian3;
  if (center instanceof Cesium.Cartesian3) {
    centerCartesian = center;
  } else {
    centerCartesian = Cesium.Cartesian3.fromDegrees(
      center.lng,
      center.lat,
      center.height ?? height
    );
  }

  // 处理填充材质/颜色
  let finalMaterial: Cesium.MaterialProperty | Cesium.Color;
  if (typeof material === "string") {
    // RGB 字符串格式，应用透明度
    finalMaterial = Cesium.Color.fromCssColorString(material).withAlpha(alpha);
  } else if (material instanceof Cesium.Color) {
    // Cesium.Color 对象，应用透明度
    finalMaterial = material.withAlpha(alpha);
  } else if (material) {
    // MaterialProperty，直接使用
    finalMaterial = material;
  } else {
    // 默认颜色
    finalMaterial = Cesium.Color.DARKMAGENTA.withAlpha(alpha);
  }

  // 处理描边颜色
  let finalOutlineColor: Cesium.Color;
  if (typeof outlineColor === "string") {
    // RGB 字符串格式
    finalOutlineColor = Cesium.Color.fromCssColorString(outlineColor);
  } else if (outlineColor) {
    // Cesium.Color 对象
    finalOutlineColor = outlineColor;
  } else {
    // 默认颜色
    finalOutlineColor = Cesium.Color.DARKMAGENTA;
  }

  // 在中心点构建 ENU 坐标系
  const enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);

  // 处理描述文字颜色
  const descriptionText = (description ?? "").trim();
  const descriptionColorValue = descriptionColor || Cesium.Color.WHITE;
  const finalDescriptionColor =
    typeof descriptionColorValue === "string"
      ? Cesium.Color.fromCssColorString(descriptionColorValue)
      : descriptionColorValue;

  // 角度转弧度（0° 为正北，顺时针为正方向）
  let startRad = Cesium.Math.toRadians(startAngle);
  let endRad = Cesium.Math.toRadians(endAngle);

  // 计算角度差，保证 sweep 为 [0, 2π)
  let sweep = endRad - startRad;
  if (sweep < 0) {
    sweep += 2 * Math.PI;
  }
  if (sweep === 0) {
    console.warn("drawSectorByParams: startAngle 与 endAngle 形成的扇形角度为 0");
    return null;
  }

  const steps = 64;
  const step = sweep / steps;

  // 生成扇形顶点（中心点 + 弧线采样点）
  const cartesianPoints: Cesium.Cartesian3[] = [];
  cartesianPoints.push(centerCartesian);

  for (let i = 0; i <= steps; i++) {
    const angle = startRad + step * i;
    // ENU: x=East, y=North，z=Up（此处 z=0，保持平面扇形）
    const local = new Cesium.Cartesian3(
      radius * Math.sin(angle), // East
      radius * Math.cos(angle), // North
      0
    );
    const world = Cesium.Matrix4.multiplyByPoint(
      enuFrame,
      local,
      new Cesium.Cartesian3()
    );
    cartesianPoints.push(world);
  }

  // 绘制扇形（Polygon）
  viewer.entities.add({
    properties: {
      drawShapeFlag: true,
      drawShapeType: "sector",
    } as any,
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(cartesianPoints),
      material: finalMaterial,
      outline: true,
      outlineColor: finalOutlineColor,
      outlineWidth: outlineWidth,
      height: height,
      extrudedHeight: extrudedHeight,
    },
  });

  // 绘制描述（Label）：显示在扇形内部，默认用中心点位置
  if (descriptionText) {
    const fontSizePx = Number.isFinite(descriptionFontSize) && descriptionFontSize! > 0 ? descriptionFontSize : 16;

    // 扇形区域内部“居中”位置：沿角平分线方向，取半径的 0.6 倍处
    const midRad = startRad + sweep / 2;
    const labelLocal = new Cesium.Cartesian3(
      radius * 0.6 * Math.sin(midRad), // East
      radius * 0.6 * Math.cos(midRad), // North
      0
    );
    const labelWorld = Cesium.Matrix4.multiplyByPoint(
      enuFrame,
      labelLocal,
      new Cesium.Cartesian3()
    );

    viewer.entities.add({
      properties: {
        drawShapeFlag: true,
        drawShapeType: "sector-label",
      } as any,
      position: labelWorld,
      label: {
        text: descriptionText,
        fillColor: finalDescriptionColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        font: `${fontSizePx}px sans-serif`,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  viewer.scene.requestRender();
}


// 清除绘制区域
export function clearDrawShapes() {
  if (!viewer) return;

  // 若正在手动绘制航迹，先移除临时航迹实体并重置状态
  if (tempPathEntity) {
    viewer.entities.remove(tempPathEntity);
    tempPathEntity = null;
  }
  isDrawingPath.value = false;
  drawingPathPoints.value = [];

  const toRemove: Cesium.Entity[] = [];
  const entities = viewer.entities.values;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i] as Cesium.Entity;
    const props = (e.properties as any) || {};
    // 作战范围由界面按钮统一控制，不作为“标绘图形”清理对象
    const isBattleRange =
      Boolean(props.battleRangeFlag?.getValue?.(viewer!.clock.currentTime) ?? props.battleRangeFlag);
    // 能力探测范围由界面按钮统一控制，不作为“标绘图形”清理对象
    const isDetectionRange =
      Boolean(
        props.detectionRangeFlag?.getValue?.(viewer!.clock.currentTime) ??
          props.detectionRangeFlag
      );

    if (props.drawShapeFlag && !isBattleRange && !isDetectionRange) {
      toRemove.push(e);
    }
  }

  toRemove.forEach((ent) => viewer!.entities.remove(ent));
  viewer.scene.requestRender();
}


/** 计算时钟进度比例 */
export function calcClockRatioPercent(): number | null {
  if (!viewer) return null;
  const clock = viewer.clock;
  const total = Cesium.JulianDate.secondsDifference(clock.stopTime, clock.startTime);
  if (!(total > 0)) return null;
  const cur = Cesium.JulianDate.secondsDifference(clock.currentTime, clock.startTime);
  const ratio = Cesium.Math.clamp(cur / total, 0, 1);
  return ratio * 100;
}

// 北京时间字符串 -> UTC 毫秒（避免本地时区影响）
export function parseBjToUtcMs(t: string): number {
  const m = String(t)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6]);
  const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;
  return Date.UTC(y, mo - 1, d, hh, mm, ss) - BJ_OFFSET_MS;
}


/*
  *拖动/点击时间轴时，同步 Cesium 当前时间，让运动实体立即显示到该时刻
*/
export function setCesiumCurrentTimeByTimelinePercent(
  percent0to100: number,
  startText: string,
  endText: string
) {
  if (!viewer) return;
  const startMs = parseBjToUtcMs(startText);
  const endMs = parseBjToUtcMs(endText);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
  if (!(endMs > startMs)) return;

  const p = Number(percent0to100);
  if (!Number.isFinite(p)) return;
  const ratio = Math.min(1, Math.max(0, p / 100));
  const curMs = startMs + (endMs - startMs) * ratio;
  const curDateUtc = new Date(curMs);
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(curDateUtc);
  viewer.scene.requestRender();
}

/**
 * 高精度的时间轴 tooltip 格式化函数
 * 用于将时间轴的百分比数值（0~100）转换为标准化的日期时间字符串（格式：YYYY-MM-DD HH:mm:ss），
 * 底层通过解析时间轴的起止时间文本、计算进度比例来得到对应时刻，
 * 同时包含完善的异常兜底逻辑，保证 tooltip 文本始终有效显示
 * @param val 
 */
export function formatTimelineTooltip(val: number,startText: string,endText: string): string {
  const parse = (t: string): Date | null => {
    const m = String(t)
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = Number(m[6]);
    const dt = new Date(y, mo - 1, d, hh, mm, ss);
    return Number.isFinite(dt.getTime()) ? dt : null;
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  const format = (dt: Date): string =>
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(
      dt.getHours()
    )}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

  let start = parse(startText);
  let end = parse(endText);
  if (!start || !end) return "";

  // 兜底：如果结束时间早于开始时间，交换一下，避免 tooltip 计算为空导致不显示
  if (end.getTime() < start.getTime()) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const total = end.getTime() - start.getTime();
  if (total === 0) return format(start);
  if (!(total > 0)) return "";

  const v = Number(val);
  if (!Number.isFinite(v)) return "";
  const ratio = Math.min(1, Math.max(0, v / 100));
  const cur = new Date(start.getTime() + total * ratio);
  return format(cur);
}





function getEntityPropString(entity: Cesium.Entity, key: string): string | undefined {
  const bag = entity.properties as any;
  const prop = bag?.[key];
  if (!prop) return undefined;
  // Property / ConstantProperty
  if (typeof prop.getValue === "function") {
    const v = prop.getValue(viewer?.clock?.currentTime);
    return typeof v === "string" ? v : String(v);
  }
  return typeof prop === "string" ? prop : String(prop);
}

function applyBattleRangeVisibility(entity: Cesium.Entity) {
  const ownerId = getEntityPropString(entity, "battleRangeOwnerId");
  const localVisible = ownerId ? (battleRangeOwnerVisible.get(ownerId) ?? true) : true;
  entity.show = Boolean(battleRangeVisible.value && localVisible);
}

function registerBattleRangeEntity(entity: Cesium.Entity) {
  battleRangeEntities.push(entity);
  applyBattleRangeVisibility(entity);
}

function applySignalSourceVisibility(entity: Cesium.Entity) {
  const ownerId = getEntityPropString(entity, "signalSourceOwnerId");
  const localVisible = ownerId ? (signalSourceOwnerVisible.get(ownerId) ?? true) : true;
  entity.show = Boolean(signalSourceVisible.value && localVisible);
}

function registerSignalSourceEntity(entity: Cesium.Entity) {
  signalSourceEntities.push(entity);
  applySignalSourceVisibility(entity);
}

function applyDetectionRangeVisibility(entity: Cesium.Entity) {
  const ownerId = getEntityPropString(entity, "detectionRangeOwnerId");
  const localVisible = ownerId ? (detectionRangeOwnerVisible.get(ownerId) ?? true) : true;
  entity.show = Boolean(detectionRangeVisible.value && localVisible);
}

function registerDetectionRangeEntity(entity: Cesium.Entity) {
  detectionRangeEntities.push(entity);
  applyDetectionRangeVisibility(entity);
}
