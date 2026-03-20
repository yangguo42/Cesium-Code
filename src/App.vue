<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as Cesium from "cesium";
import Scene from "@/views/scene/index.vue";
import SiteChoice from "@/views/scene/components/platformChoice.vue";
import Site from "@/views/platform/index.vue";
import Situation from "@/views/situation/index.vue";
import { useConfigStore } from "@/stores/config";
import type { Viewer } from "cesium";
import { usePlatformStore } from "@/stores/platform";
import * as mapTool from "@/utils/mapTool";
import type {
  DrawCircleResult,
  DrawPolygonResult,
  DrawEllipseResult,
  DrawVoyagePathResult,
} from "@/utils/mapTool";
import {
  mapSource,
  viewMode,
  mouseLng,
  mouseLat,
  contextMenuVisible,
  isDrawingPath,
  contextMenuX,
  contextMenuY,
} from "@/utils/mapTool";
let viewer: Viewer | undefined;
const activeMenu = ref();
const checked = ref(true);

// 左键点击实体信息面板
type ClickedEntityInfo = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  height: number;
  txFreq: number;
  radarDetectionRange: number;
};
const clickedEntityInfo = ref<ClickedEntityInfo | null>(null);
let leftClickHandler: Cesium.ScreenSpaceEventHandler | null = null;

// 时间播放控制
const isPlaying = ref(false);

// 场景内容加载完成提示（居中常驻）
const sceneContentLoaded = ref(false);
const sceneLoadedModalVisible = ref(false);

const playbackRate = ref(1);

const playbackRateOptions = [
  { label: "1x", value: 1 },
  { label: "5x", value: 5 },
  { label: "10x", value: 10 },
  { label: "20x", value: 20 },
  { label: "50x", value: 50 },
  { label: "100x", value: 100 },
];

// 底部时间滑动块：两侧显示开始/结束时间（由后台接口返回）
const timelineValue = ref(0);


const timelineStartText = ref("--");
const timelineEndText = ref("--");

// 时间滑动块步进（百分比）：让 60 秒≈一个 step（1分钟一格）
const timelineStep = computed(() => {
  const startMs = mapTool.parseBjToUtcMs(timelineStartText.value);
  const endMs = mapTool.parseBjToUtcMs(timelineEndText.value);
  const totalSec = (endMs - startMs) / 1000;
  if (!Number.isFinite(totalSec) || totalSec <= 0) return 0.1;
  // 60 秒（1分钟）对应的百分比
  const per60Sec = 100 / (totalSec / 60);
  // 兜底：不要太大（影响拖动精度），也不要太小（支持超长时间区间下的“按分钟移动”）
  return Math.min(10, Math.max(0.000001, per60Sec));
});

let dragDebounceTimer: number | null = null;
const isTimelineDragging = ref(false);
let timelineSyncRaf: number | null = null;

const timelineTooltipText = computed(() => 
  mapTool.formatTimelineTooltip(timelineValue.value,timelineStartText.value,timelineEndText.value)
);

function startTimelineDrag() {
  // 未加载完成/未确认提示前，禁止拖动时间轴
  if (!sceneContentLoaded.value || sceneLoadedModalVisible.value) return;
  isTimelineDragging.value = true;
}

function endTimelineDrag() {
  isTimelineDragging.value = false;
}

/** 开始时间轴同步
 * 在 Cesium 时钟处于播放状态（isPlaying.value = true）且未拖拽时间轴时，
 * 通过浏览器的动画帧（requestAnimationFrame）实时计算时钟进度比例，
 * 同步更新自定义时间轴的数值（timelineValue.value）
 * 从而实现时间轴与 Cesium 时钟的实时同步，让运动实体在时间轴上准确显示
 */
function startTimelineSync() {
  if (timelineSyncRaf != null) return;
  const tick = () => {
    timelineSyncRaf = window.requestAnimationFrame(tick);
    if (!isPlaying.value) return;
    if (isTimelineDragging.value) return;
    const p = mapTool.calcClockRatioPercent();
    if (p == null) return;
    timelineValue.value = p;
    // 时间轴走到末尾：自动停止播放，让播放按钮回到“停止/暂停”状态
    if (p >= 100) {
      isPlaying.value = false;
      mapTool.pauseAnimation();
      timelineValue.value = 100;
    }
  };
  timelineSyncRaf = window.requestAnimationFrame(tick);
}

/** 停止时间轴同步 */
function stopTimelineSync() {
  if (timelineSyncRaf == null) return;
  window.cancelAnimationFrame(timelineSyncRaf);
  timelineSyncRaf = null;
}







// 右键菜单：作战范围（单体）显示控制
const hasSelectedBattleRange = computed(() => mapTool.hasSelectedBattleRange());
const selectedBattleRangeLocalVisible = computed(() => mapTool.getSelectedBattleRangeLocalVisible());
const selectedBattleRangeMenuText = computed(() => {
  // 全局关了时，菜单仍允许切“单体目标态”，但实际仍会被全局开关隐藏
  const localText = selectedBattleRangeLocalVisible.value ? "显示" : "隐藏";
  return mapTool.battleRangeVisible.value ? `作战范围: ${localText}` : `作战范围(全局已隐藏): ${localText}`;
});

function toggleSelectedBattleRangeFromMenu() {
  if (!mapTool.selectedEntity.value) return;
  mapTool.toggleSelectedBattleRangeVisible();
  contextMenuVisible.value = false;
}

// 右键菜单：信号源（单体）显示控制
const hasSelectedSignalSource = computed(() => mapTool.hasSelectedSignalSource());
const selectedSignalSourceLocalVisible = computed(() => mapTool.getSelectedSignalSourceLocalVisible());
const selectedSignalSourceMenuText = computed(() => {
  const localText = selectedSignalSourceLocalVisible.value ? "显示" : "隐藏";
  return mapTool.signalSourceVisible.value ? `信号源: ${localText}` : `信号源(全局已隐藏): ${localText}`;
});

function toggleSelectedSignalSourceFromMenu() {
  if (!mapTool.selectedEntity.value) return;
  mapTool.toggleSelectedSignalSourceVisible();
  contextMenuVisible.value = false;
}

// 右键菜单：能力探测范围（单体）显示控制
const hasSelectedDetectionRange = computed(() => mapTool.hasSelectedDetectionRange());
const selectedDetectionRangeLocalVisible = computed(() => mapTool.getSelectedDetectionRangeLocalVisible());
const selectedDetectionRangeMenuText = computed(() => {
  const localText = selectedDetectionRangeLocalVisible.value ? "显示" : "隐藏";
  return mapTool.detectionRangeVisible.value
    ? `能力探测范围: ${localText}`
    : `能力探测范围(全局已隐藏): ${localText}`;
});

function toggleSelectedDetectionRangeFromMenu() {
  if (!mapTool.selectedEntity.value) return;
  mapTool.toggleSelectedDetectionRangeVisible();
  contextMenuVisible.value = false;
}

// 最近一次手动绘制图形的结果
const lastDrawnShapes = ref<{
  voyagePath: DrawVoyagePathResult | null;
  circle: DrawCircleResult | null;
  polygon: DrawPolygonResult | null;
  ellipse: DrawEllipseResult | null;
}>({
  voyagePath: null,
  circle: null,
  polygon: null,
  ellipse: null,
});


const sceneList = ref<Scene[]>([
  {
    id: "1",
    title: "场景1",
    no: "XDBH-20240712-0007",
    type: "目标定位",
    startTime: "2025-01-18 00:00:00",
    endTime: "2025-01-18 00:00:00",
    cerateTime: "2025-01-18 00:00:00",
    platform: [
      { name: "侦察机", id: "1" },
      { name: "通信保障车", id: "5" },
      { name: "测控站", id: "9" },
    ],
  },
  {
    id: "2",
    title: "场景2",
    no: "XDBH-20240712-0007",
    type: "目标定位",
    startTime: "2025-01-18 00:00:00",
    endTime: "2025-01-18 00:00:00",
    cerateTime: "2025-01-18 00:00:00",
    platform: [{ name: "侦察机", id: "1" }],
  },
  {
    id: "3",
    title: "场景3",
    no: "XDBH-20240712-0007",
    type: "目标定位",
    startTime: "2025-01-18 00:00:00",
    endTime: "2025-01-18 00:00:00",
    cerateTime: "2025-01-18 00:00:00",
    platform: [
      { name: "通信保障车", id: "5" },
      { name: "测控站", id: "9" },
    ],
  },
]);


//测试数据
async function test(){

    // 性能：分批创建大模型，避免同一帧解析多个 glb 造成卡顿
    const nextFrame = () =>
      new Promise<void>((resolve) =>
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(() => resolve())
          : setTimeout(() => resolve(), 0)
    );

      //卫星
    const starTrackParams = {
        satEphs:[{
          satName:"卫星1",
          ephs:[
  {"x":25090691.573222,"y":33873217.346212,"z":-35670.4975529,"t":1773192996},
  {"x":25090583.311632,"y":33873211.894665,"z":-35768.7536098,"t":1773193056},
  {"x":25090474.645444,"y":33873206.907295,"z":-35866.3282385,"t":1773193116},
  {"x":25090365.576635,"y":33873202.384390,"z":-35963.2194290,"t":1773193176},
  {"x":25090256.106065,"y":33873198.326891,"z":-36059.4253845,"t":1773193236},
  {"x":25090146.236206,"y":33873194.734597,"z":-36154.9442500,"t":1773193296},
  {"x":25090035.967815,"y":33873191.608576,"z":-36249.7741903,"t":1773193356},
  {"x":25089925.304122,"y":33873188.948062,"z":-36343.9133797,"t":1773193416},
  {"x":25089814.245893,"y":33873186.754106,"z":-36437.360003,"t":1773193476},
  {"x":25089702.795636,"y":33873185.026472,"z":-36530.112265,"t":1773193536},
  {"x":25089590.953889,"y":33873183.766373,"z":-36622.168378,"t":1773193596},
  {"x":25089478.723418,"y":33873182.973373,"z":-36713.526570,"t":1773193656},
  {"x":25089366.105764,"y":33873182.647939,"z":-36804.185082,"t":1773193716},
  {"x":25089253.102591,"y":33873182.790385,"z":-36894.142228,"t":1773193776},
  {"x":25089139.715961,"y":33873183.400898,"z":-36983.396156,"t":1773193836},
  {"x":25089025.948046,"y":33873184.479410,"z":-37071.945207,"t":1773193896},
  {"x":25088911.799430,"y":33873186.027082,"z":-37159.787675,"t":1773193956},
  {"x":25088797.272923,"y":33873188.043422,"z":-37246.921868,"t":1773194016},
  {"x":25088682.370603,"y":33873190.528479,"z":-37333.346108,"t":1773194076},
  {"x":25088567.093321,"y":33873193.483202,"z":-37419.058730,"t":1773194136},
  {"x":25088451.443170,"y":33873196.907623,"z":-37504.058083,"t":1773194196},
  {"x":25088335.422497,"y":33873200.801576,"z":-37588.342528,"t":1773194256},
  {"x":25088219.033158,"y":33873205.165260,"z":-37671.910442,"t":1773194316},
  {"x":25088102.276036,"y":33873209.999587,"z":-37754.760214,"t":1773194376},
  {"x":25087985.154841,"y":33873215.303319,"z":-37836.890302,"t":1773194436},
  {"x":25087867.669752,"y":33873221.077993,"z":-37918.299014,"t":1773194496},
  {"x":25087749.823508,"y":33873227.323080,"z":-37998.984834,"t":1773194556},
  {"x":25087631.617510,"y":33873234.039095,"z":-38078.946209,"t":1773194616},
  {"x":25087513.053909,"y":33873241.225994,"z":-38158.181595,"t":1773194676},
  {"x":25087394.134362,"y":33873248.884092,"z":-38236.689465,"t":1773194736},
  {"x":25087274.861280,"y":33873257.013144,"z":-38314.468306,"t":1773194796},
  {"x":25087155.236585,"y":33873265.613263,"z":-38391.516618,"t":1773194856},
  {"x":25087035.261712,"y":33873274.684918,"z":-38467.832914,"t":1773194916},
  {"x":25086914.938843,"y":33873284.228019,"z":-38543.415722,"t":1773194976},
  {"x":25086794.270167,"y":33873294.242471,"z":-38618.263585,"t":1773195036},
  {"x":25086673.257139,"y":33873304.728713,"z":-38692.375058,"t":1773195096},
  {"x":25086551.901580,"y":33873315.686861,"z":-38765.748760,"t":1773195156},
  {"x":25086430.206461,"y":33873327.116330,"z":-38838.383177,"t":1773195216},
  {"x":25086308.172877,"y":33873339.017765,"z":-38910.276958,"t":1773195276},
  {"x":25086185.803047,"y":33873351.391022,"z":-38981.428713,"t":1773195336},
  {"x":25086063.099201,"y":33873364.235949,"z":-39051.837070,"t":1773195396},
  {"x":25085940.062832,"y":33873377.552934,"z":-39121.500670,"t":1773195456},
  {"x":25085816.696184,"y":33873391.341805,"z":-39190.418167,"t":1773195516},
  {"x":25085693.001006,"y":33873405.602751,"z":-39258.588231,"t":1773195576},
  {"x":25085568.979800,"y":33873420.335399,"z":-39326.009545,"t":1773195636},
  {"x":25085444.634825,"y":33873435.539554,"z":-39392.680807,"t":1773195696},
  {"x":25085319.967360,"y":33873451.215738,"z":-39458.600729,"t":1773195756},
  {"x":25085194.979539,"y":33873467.363789,"z":-39523.768082,"t":1773195816},
  {"x":25085069.673427,"y":33873483.983741,"z":-39588.181517,"t":1773195876},
  {"x":25084944.050917,"y":33873501.075599,"z":-39651.839836,"t":1773195936},
  {"x":25084818.114549,"y":33873518.638936,"z":-39714.741807,"t":1773195996},
  {"x":25084691.866126,"y":33873536.673865,"z":-39776.886215,"t":1773196056},
  {"x":25084565.307949,"y":33873555.180126,"z":-39838.271857,"t":1773196116},
  {"x":25084438.441094,"y":33873574.158361,"z":-39898.897548,"t":1773196176},
  {"x":25084311.269108,"y":33873593.607380,"z":-39958.762115,"t":1773196236},
  {"x":25084183.793569,"y":33873613.527441,"z":-40017.864399,"t":1773196296},
  {"x":25084056.015821,"y":33873633.918977,"z":-40076.203259,"t":1773196356},
  {"x":25083927.938190,"y":33873654.781684,"z":-40133.777564,"t":1773196416},
  {"x":25083799.563367,"y":33873676.114936,"z":-40190.586239,"t":1773196476},
  {"x":25083670.892745,"y":33873697.919211,"z":-40246.628108,"t":1773196536},
  {"x":25083541.929270,"y":33873720.193684,"z":-40301.902125,"t":1773196596},
  {"x":25083412.674556,"y":33873742.938559,"z":-40356.407219,"t":1773196656},
  {"x":25083283.130473,"y":33873766.153849,"z":-40410.142336,"t":1773196716},
  {"x":25083153.299135,"y":33873789.839379,"z":-40463.106433,"t":1773196776},
  {"x":25083023.183654,"y":33873813.994230,"z":-40515.298486,"t":1773196836},
  {"x":25082892.784927,"y":33873838.619120,"z":-40566.717483,"t":1773196896},
  {"x":25082762.105581,"y":33873863.713478,"z":-40617.362427,"t":1773196956},
  {"x":25082631.148004,"y":33873889.276907,"z":-40667.232337,"t":1773197016},
  {"x":25082499.913848,"y":33873915.309551,"z":-40716.326247,"t":1773197076},
  {"x":25082368.405122,"y":33873941.811233,"z":-40764.643235,"t":1773197136},
  {"x":25082236.625252,"y":33873968.780869,"z":-40812.182300,"t":1773197196},
  {"x":25082104.575271,"y":33873996.218995,"z":-40858.942553,"t":1773197256},
  {"x":25081972.257346,"y":33874024.125353,"z":-40904.923086,"t":1773197316},
  {"x":25081839.673649,"y":33874052.499673,"z":-40950.123006,"t":1773197376},
  {"x":25081706.826849,"y":33874081.341315,"z":-40994.541437,"t":1773197436},
  {"x":25081573.718881,"y":33874110.650174,"z":-41038.177514,"t":1773197496},
  {"x":25081440.351687,"y":33874140.426137,"z":-41081.030391,"t":1773197556},
  {"x":25081306.728441,"y":33874170.668173,"z":-41123.099235,"t":1773197616},
  {"x":25081172.850110,"y":33874201.376878,"z":-41164.383227,"t":1773197676},
  {"x":25081038.719633,"y":33874232.551385,"z":-41204.881566,"t":1773197736},
  {"x":25080904.338232,"y":33874264.192091,"z":-41244.593463,"t":1773197796},
  {"x":25080769.709449,"y":33874296.297625,"z":-41283.518172,"t":1773197856},
  {"x":25080634.834561,"y":33874328.868425,"z":-41321.654883,"t":1773197916},
  {"x":25080499.716876,"y":33874361.903282,"z":-41359.002879,"t":1773197976},
  {"x":25080364.357383,"y":33874395.402745,"z":-41395.561434,"t":1773198036},
  {"x":25080228.759054,"y":33874429.365888,"z":-41431.329834,"t":1773198096},
  {"x":25080092.923381,"y":33874463.792875,"z":-41466.307383,"t":1773198156},
  {"x":25079956.853592,"y":33874498.682582,"z":-41500.493397,"t":1773198216},
  {"x":25079820.551435,"y":33874534.034971,"z":-41533.887211,"t":1773198276},
  {"x":25079684.018912,"y":33874569.849815,"z":-41566.488172,"t":1773198336},
  {"x":25079547.258275,"y":33874606.126692,"z":-41598.295644,"t":1773198396},
  {"x":25079410.272275,"y":33874642.864808,"z":-41629.309005,"t":1773198456},
  {"x":25079273.063022,"y":33874680.063792,"z":-41659.527668,"t":1773198516},
  {"x":25079135.632584,"y":33874717.723431,"z":-41688.951003,"t":1773198576},
  {"x":25078997.983577,"y":33874755.842968,"z":-41717.578453,"t":1773198636},
  {"x":25078860.117780,"y":33874794.422305,"z":-41745.409457,"t":1773198696},
  {"x":25078722.037471,"y":33874833.460968,"z":-41772.443471,"t":1773198756},
  {"x":25078583.745427,"y":33874872.958109,"z":-41798.679964,"t":1773198816},
  {"x":25078445.243929,"y":33874912.913239,"z":-41824.118421,"t":1773198876},
  {"x":25078306.534776,"y":33874953.326222,"z":-41848.758343,"t":1773198936}
]
      }],
      imgUrl:"/img/卫星.svg",
    }
    void  mapTool.drawStarTrackPlayMotion(starTrackParams);
    await nextFrame();
    

    //从JSON文件中读取数据(静态文件)
    const fixedStationEntities: Cesium.Entity[] = [];//固定站实体
    const movingStationEntities: Cesium.Entity[] = [];//运动实体

    try {
      const res = await fetch("/aircraft_data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`读取 aircraft_data.json 失败: ${res.status} ${res.statusText}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        // 分帧逐个加载：避免一次性创建大量实体导致 UI 卡顿
        const list = data as any[];
        debugger;
        let idx = 0;
        let loadedMessageShown = false;
        const schedule = (fn: () => void) => {
          const w = (typeof window !== "undefined" ? (window as any) : undefined) as any;
          if (w && typeof w.requestIdleCallback === "function") {
            w.requestIdleCallback(() => fn(), { timeout: 800 });
            return;
          }
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => fn());
            return;
          }
          setTimeout(() => fn(), 0);
        };

        const loadNext = async () => {
          if (idx >= list.length) {
            if (fixedStationEntities.length>0 && movingStationEntities.length > 0) {
              fixedStationEntities.forEach(i=>{
                void mapTool.signalSourceInteraction(i, movingStationEntities,1500);
              });

            }
            if (!loadedMessageShown) {
              loadedMessageShown = true;
              sceneContentLoaded.value = true;
              sceneLoadedModalVisible.value = true;
            }
            return;
          }

          const item = list[idx++];
          try {
              //固定站
              if(item.type===0){
                  const fixedStation =  await mapTool.drawFixedStation({
                    name: item.name,
                    lon:  item.lon,
                    lat: item.lat,
                    alt: item.alt,
                    threeDimensional: item.threeDimensional,
                    labelFont: "10pt 微软雅黑",
                  });
                  //绘制雷达扫描范围
                  if(fixedStation){
                    await mapTool.detectionRange({
                        center: fixedStation,
                        radius: 1500000,
                        startAngle: 40,
                        endAngle: 115,
                        ownerId: fixedStation?.id,
                        scanEnabled: true,
                        scanPeriodSeconds: 6,
                        color: "rgb(0, 187, 102)"
                    })
                    fixedStationEntities.push(fixedStation);
                  }
                  if(item.isHighlight===1 && fixedStation){
                      mapTool.drawEntityHighlight(fixedStation);
                  }
              }
               //运动实体
              if(item.type===1){
                  const movingStation =await mapTool.drawMovingStation({
                        name: item.name,
                        waypoints: item.waypoints,
                        startTime: new Date(item.startTime),
                        endTime: new Date(item.endTime),
                        threeDimensional: item.threeDimensional,
                        trackWidth: 1,
                        trackColor: item.iffType==0?"blue":"red",
                        labelFont: "12pt 微软雅黑",
                  });
                  if(movingStation){
                    movingStationEntities.push(movingStation);
                  } 
                  if(item.isHighlight===1 && movingStation){
                      mapTool.drawEntityHighlight(movingStation);
                  }
              } 

          } finally {
            schedule(() => void loadNext());
          }
        };

        schedule(() => void loadNext());
      } else {
        console.warn("aircraft_data.json 不是数组(list)，实际为：", data);
      }


    } catch (e) {
      console.warn("读取 /aircraft_data.json 失败，请把文件放到项目 public/ 下。", e);
    }



}




onMounted(() => {

  //初始化地图以及Cesium组件
  viewer = mapTool.initMap();
  if (!viewer) return;

  //初始化右键菜单事件
  const contextHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  mapTool.rightclickEvent(contextHandler, viewer);
  
  //初始化鼠标移动事件
  const mousePositionHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  mapTool.mousePosition(mousePositionHandler, viewer);

  //初始化鼠标移动到实体上时，右边显示经纬度
  const mouseMoveEntityHighlightHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  mapTool.mouseMoveEntityHighlight(mouseMoveEntityHighlightHandler, viewer);
  
  // 初始化左键点击实体事件：在右侧弹窗显示经纬度和实体信息
  leftClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  leftClickHandler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    // 绘制航迹模式下左键已被占用，这里不拦截
    if (isDrawingPath.value) return;
    if (!viewer) return;

    const pickedObjects = viewer.scene.drillPick(click.position);
    let pickedPickableEntity: Cesium.Entity | null = null;
    for (const picked of pickedObjects) {
      if (picked && Cesium.defined((picked as any).id)) {
        const e = (picked as any).id as Cesium.Entity;
        // billboard / 3D model 都支持左键弹窗
        if (e.billboard || (e as any).model) {
          pickedPickableEntity = e;
          break;
        }
      }
    }

    if (!pickedPickableEntity) {
      // 点击空白处关闭信息面板
      clickedEntityInfo.value = null;
      return;
    }   

    const time = viewer.clock.currentTime;
    const posProp: any = pickedPickableEntity.position;
    const pos: Cesium.Cartesian3 | undefined =
      posProp && typeof posProp.getValue === "function"
        ? posProp.getValue(time)
        : posProp;
    if (!pos) {
      clickedEntityInfo.value = null;
      return;
    }
    const carto = Cesium.Cartographic.fromCartesian(pos);
    clickedEntityInfo.value = {
      id: pickedPickableEntity.id,
      name: pickedPickableEntity.name || pickedPickableEntity.id,
      lng: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height ?? 0,
      txFreq: pickedPickableEntity.properties?.txFreq ?? 0,
      radarDetectionRange: pickedPickableEntity.properties?.radarDetectionRange ?? 0,
    };
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);


  // 初始化播放倍速为 1x
  mapTool.setPlaybackRate(1);

  //初始化底部时间滑动块两侧时间
  timelineStartText.value = "2026-03-11 09:36:36";
  timelineEndText.value = "2026-03-11 11:15:36";
  //设置时钟区间
  mapTool.setClockRangeByBjTimeStrings(timelineStartText.value, timelineEndText.value);
  // 性能：地图先初始化可交互，再在空闲/下一帧逐步加载测试模型，避免阻塞初始化
  const runAfterInit = (fn: () => void) => {
    const w = window as any;
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(() => fn(), { timeout: 1500 });
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => fn());
      return;
    }
    setTimeout(() => fn(), 0);
  };
  runAfterInit(() => void test());

  // 用 window 兜底结束拖动（避免鼠标在 slider 外抬起导致 tooltip 不消失）
  window.addEventListener("mouseup", endTimelineDrag);
  window.addEventListener("touchend", endTimelineDrag);
  window.addEventListener("touchcancel", endTimelineDrag);

  // 若初始化就是播放态，也能同步（通常 isPlaying 初始为 false）
  startTimelineSync();
});

/** 卸载前清理事件 */
onBeforeUnmount(() => {
  if (dragDebounceTimer) {
    window.clearTimeout(dragDebounceTimer);
    dragDebounceTimer = null;
  }

  window.removeEventListener("mouseup", endTimelineDrag);
  window.removeEventListener("touchend", endTimelineDrag);
  window.removeEventListener("touchcancel", endTimelineDrag);
  stopTimelineSync();
  stopPositionPolling();
  if (leftClickHandler) {
    leftClickHandler.destroy();
    leftClickHandler = null;
  }
});


/*
  自定义时间轴输入事件
  1.标准化处理时间轴的输入值（兼容数组 / 单个数值），过滤无效值；
  2.同步更新自定义时间轴的数值状态，并将该数值转换为 Cesium 时钟时间；
  3.标记时间轴拖拽状态，确保拖拽过程中 UI 表现稳定（如 tooltip 不消失）；
  4.通过防抖定时器避免拖拽时频繁触发不必要的 UI 抖动。
*/
function onTimelineInput(val: number | number[]) {
  const raw = Array.isArray(val) ? val[0] : val;
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  timelineValue.value = v;
  // 拖动/点击时间轴时，同步 Cesium 当前时间，让运动实体立即显示到该时刻
  mapTool.setCesiumCurrentTimeByTimelinePercent(v, timelineStartText.value, timelineEndText.value);
  // 拖动中保证 tooltip 可见（键盘/点击轨道也会触发 input）
  if (!isTimelineDragging.value) isTimelineDragging.value = true;
  if (dragDebounceTimer) window.clearTimeout(dragDebounceTimer);
  dragDebounceTimer = window.setTimeout(() => {
    // no-op: 仅用于让拖动时 tooltip/显示更稳定
  }, 250);
}


function toggleAllBattleRanges() {
  mapTool.toggleAllBattleRangesVisible();
}

function toggleAllSignalSources() {
  mapTool.toggleAllSignalSourcesVisible();
}

function toggleAllDetectionRanges() {
  mapTool.toggleAllDetectionRangesVisible();
}

function toggleAllFullTrackLines() {
  mapTool.toggleAllFullTrackLinesVisible();
}

function togglePlay() {
  isPlaying.value = !isPlaying.value;
  if (isPlaying.value) {
    mapTool.playAnimation();
  } else {
    mapTool.pauseAnimation();
  }
}

/*
  响应式监听时钟播放状态
  监听 isPlaying 响应式变量的变化，当 Cesium 时钟从「暂停」变为「播放」时启动时间轴同步，
  从「播放」变为「暂停」时停止同步，实现播放 / 暂停状态与时间轴同步的自动联动
*/
watch(isPlaying, (v) => {
  if (v) {
    startTimelineSync();
    startPositionPolling();
  } else {
    stopTimelineSync();
    stopPositionPolling();
  }
});

// 播放时：每 3 秒获取一次“当前选中实体/模型”的位置信息
let positionPollTimer: number | null = null;
function startPositionPolling() {
  if (positionPollTimer != null) return;
  const tick = () => {
    if (!isPlaying.value) return;
    const positions = mapTool.getAllEntityOrModelPositionsDegrees();
    // TODO: 若需要上屏/上报，可把这里改成写入 ref 或调用接口
    console.log("[positions@3s]", positions);
  };
  // 立即取一次 + 每 3 秒轮询
  tick();
  positionPollTimer = window.setInterval(tick, 3000);
}

function stopPositionPolling() {
  if (positionPollTimer == null) return;
  window.clearInterval(positionPollTimer);
  positionPollTimer = null;
}



//设置播放倍数
function onPlaybackRateChange(val: string | number) {
  const rate = typeof val === "string" ? Number(val) : val;
  if (!Number.isFinite(rate) || rate <= 0) return;
  playbackRate.value = rate;
  mapTool.setPlaybackRate(rate);
}




  // 手动绘制多边形，只负责绘制并记录结果
  async function startDrawPolygon() {
    const result = await mapTool.drawingPolygon();
    if (!result) return;
    lastDrawnShapes.value.polygon = result;
  }

// 手动绘制航迹，只负责绘制并记录结果
async function startDrawVoyagePath() {
  const result = await mapTool.drawingVoyagePath();
  if (!result) return;
  console.log("航迹绘制结果:", result);
  lastDrawnShapes.value.voyagePath = result;
}

// 手动绘制圆形，只负责绘制并记录结果
async function startDrawCircle() {
  const result = await mapTool.drawingCircle();
  if (!result) return;
 
  lastDrawnShapes.value.circle = result;
}

// 手动绘制椭圆形，只负责绘制并记录结果
async function startDrawEllipse() {
  const result = await mapTool.drawingEllipse();
  if (!result) return;
  lastDrawnShapes.value.ellipse = result;
}

// 使用最近一次绘制的图形参数调用后台接口
async function callShapesApi() {
  const circles = lastDrawnShapes.value.circle
    ? [
        {
          centerLng: lastDrawnShapes.value.circle.lng,
          centerLat: lastDrawnShapes.value.circle.lat,
          centerHeight: lastDrawnShapes.value.circle.height,
          radius: lastDrawnShapes.value.circle.radius,
        },
      ]
    : [];

  const polygons = lastDrawnShapes.value.polygon
    ? [
        {
          points: lastDrawnShapes.value.polygon.pointsDegrees,
        },
      ]
    : [];

  const ellipses = lastDrawnShapes.value.ellipse
    ? [
        {
          centerLng: lastDrawnShapes.value.ellipse.lng,
          centerLat: lastDrawnShapes.value.ellipse.lat,
          centerHeight: lastDrawnShapes.value.ellipse.height,
          semiMajor: lastDrawnShapes.value.ellipse.semiMajor,
          semiMinor: lastDrawnShapes.value.ellipse.semiMinor,
        },
      ]
    : [];

  if (!circles.length && !polygons.length && !ellipses.length) {
    console.warn("尚未绘制任何图形，无法调用后台接口");
    return;
  }

  const payload = {
    circles,
    polygons,
    ellipses,
  };

  // 调用后台接口（根据实际地址调整）
  await fetch("/api/shapes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

//#region 根据菜单显示内容
const menuList = computed(() => {
  return useConfigStore()
    .config.system.filter((item) => item.show)
    .map((item) => {
      return {
        ...item,
        children: item.children?.filter((item1) => item1.show),
      };
    });
});
//点击菜单和场景管理里选择平台
function handleClick(menu: any) {
  activeMenu.value = menu;
  checked.value = false; //弹出左边Draw
  //router.push(`/tool?id=${activeMenu.value.id}`)
}
//const label = computed(() => activeMenu.value?.label)
const currentComponent = computed(() => {
  let temp = null;
  switch (activeMenu.value?.id) {
    case "11":
      temp = Scene;
      break;
    case "11_1":
      temp = SiteChoice;
      break;
    case "12":
      temp = Site;
      break;
    case "13":
      temp = Situation;
      break;
    default:
      break;
  }
  return temp;
});
//#endregion
//#region 场景相关
//新建场景(场景管理)
function saveSceneClick(scene: Scene) {
  sceneList.value.push(scene);
}
//选择平台(场景管理)
function saveChoice(res: Platform[]) {
  handleClick(menuList.value[0]!.children![0]); //返回场景管理页面
  let index = sceneList.value.findIndex(
    (f) => f.id === usePlatformStore().getCurrentAddScene?.id
  );
  if (index < 0) return;
  sceneList.value![index]!.platform = [];
  sceneList.value![index]!.platform = [...res];
}
//点击切换场景(态势展示)
function sitSceneClick(scene: Scene) {
  viewer!.dataSources.removeAll();
  scene.platform.forEach((platform) => {
    if (platform.id === "1")
      //侦察机
      viewer!.dataSources.add(Cesium.CzmlDataSource.load("/ZCJ.czml"));
    if (platform.id === "5")
      //通信保障车
      viewer!.dataSources.add(Cesium.CzmlDataSource.load("/TXBZC.czml"));
    if (platform.id === "9")
      //测控站
      viewer!.dataSources.add(Cesium.CzmlDataSource.load("/TX.czml"));
  });
}
//#endregion




//#endregion
</script>

<template>
  <div id="cesiumContainer">
    <input type="checkbox" id="show_check" v-model="checked" />
    <div class="show">
      <label for="show_check"> ◀ </label>
    </div>
    <div class="drawer">
      <Transition name="fade" mode="out-in">
        <component
          :is="currentComponent"
          :handleClick="handleClick"
          :saveSceneClick="saveSceneClick"
          :saveChoice="saveChoice"
          :sceneList="sceneList"
          :sitSceneClick="sitSceneClick"
        ></component>
      </Transition>
    </div>

    <!-- 右侧实体信息弹窗 -->
    <div v-if="clickedEntityInfo" id="entityInfoPanel">
      <div class="entity-info-title">{{ clickedEntityInfo.name }}</div>
      <div class="entity-info-row">
        <span class="label">通信频率：</span>
        <span class="value">{{ clickedEntityInfo.txFreq/1000000}}MHz</span>
      </div>
      <div class="entity-info-row">
        <span class="label">雷达探测范围：</span>
        <span class="value">{{ clickedEntityInfo.radarDetectionRange}}(公里)</span>
      </div>
      <div class="entity-info-row">
        <span class="label">经度：</span>
        <span class="value">{{ clickedEntityInfo.lng.toFixed(6) }}°</span>
      </div>
      <div class="entity-info-row">
        <span class="label">纬度：</span>
        <span class="value">{{ clickedEntityInfo.lat.toFixed(6) }}°</span>
      </div>
      <div class="entity-info-row">
        <span class="label">高度：</span>
        <span class="value">{{ clickedEntityInfo.height.toFixed(1) }} m</span>
      </div>
    </div>

    <div id="menuList">
      <div v-for="item in menuList" :key="item.label" class="menu">
        <div
          :class="{
            'content-item': true,
            active: item1.label === activeMenu?.label,
          }"
          v-for="item1 in item.children"
          @click="handleClick(item1)"
          :key="item1.label"
        >
          <div class="label">{{ item1.label }}</div>
          <div class="describe" v-if="item1.describe">
            ( {{ item1.describe }} )
          </div>
        </div>
      </div>
    </div>

    <!-- 地图源切换按钮、2D/3D切换按钮、时间播放控制、图形调用后台按钮 -->
    <div id="mapSourceSwitch">
      <div class="switch-group">
        <el-button type="primary" size="small" @click="mapTool.switchMapSource()">
          {{ mapSource === "goolmap" ? "切换到: 卫星图" : "切换到: 地图" }}
        </el-button>
        <div class="map-source-label">
          当前: {{ mapSource === "goolmap" ? "地图" : "卫星图" }}
        </div>
      </div>
      <div class="switch-group">
        <el-button type="primary" size="small" @click="mapTool.switchViewMode()">
          {{ viewMode === "3D" ? "视图切换到: 2D" : "视图切换到: 3D" }}
        </el-button>
        <div class="map-source-label">
          当前: {{ viewMode === "3D" ? "3D视图" : "2D视图" }}
        </div>
      </div>
      <div class="switch-group">
        <div style="display: flex; align-items: center; gap: 8px">
          <el-tooltip
            content="场景内容未加载完成,请等待加载完成后再进行播放"
            placement="top"
            :disabled="sceneContentLoaded"
          >
            <span style="display: inline-block">
              <el-button type="primary" size="small" :disabled="!sceneContentLoaded" @click="togglePlay">
                {{ isPlaying ? "暂停" : "播放" }}
              </el-button>
            </span>
          </el-tooltip>
          <el-select
            v-model="playbackRate"
            size="small"
            style="width: 90px"
            @change="onPlaybackRateChange"
          >
            <el-option
              v-for="opt in playbackRateOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div class="map-source-label">
          时间: {{ isPlaying ? "播放中" : "暂停" }} · {{ playbackRate }}x
        </div>
      </div>
      <div class="switch-group">
        <el-button type="success" size="small" @click="callShapesApi()">
          调用图形后台
        </el-button>
      </div>

      <div class="switch-group">
        <el-button
          :type="mapTool.battleRangeVisible.value ? 'success' : 'info'"
          :plain="!mapTool.battleRangeVisible.value"
          size="small"
          @click="toggleAllBattleRanges()"
        >
          作战范围: {{ mapTool.battleRangeVisible.value==true ? '已开启' : '已关闭' }}
        </el-button>
      </div>

      <div class="switch-group">
        <el-button
          :type="mapTool.signalSourceVisible.value ? 'success' : 'info'"
          :plain="!mapTool.signalSourceVisible.value"
          size="small"
          @click="toggleAllSignalSources()"
        >
          信号源: {{ mapTool.signalSourceVisible.value==true ? '已开启' : '已关闭' }}
        </el-button>
      </div>

      <div class="switch-group">
        <el-button
          :type="mapTool.detectionRangeVisible.value ? 'success' : 'info'"
          :plain="!mapTool.detectionRangeVisible.value"
          size="small"
          @click="toggleAllDetectionRanges()"
        >
          能力探测范围: {{ mapTool.detectionRangeVisible.value==true ? '已开启' : '已关闭' }}
        </el-button>
      </div>

      <div class="switch-group">
        <el-button
          :type="mapTool.fullTrackLineVisible.value ? 'success' : 'info'"
          :plain="!mapTool.fullTrackLineVisible.value"
          size="small"
          @click="toggleAllFullTrackLines()"
        >
          完整航迹线: {{ mapTool.fullTrackLineVisible.value==true ? '已开启' : '已关闭' }}
        </el-button>
      </div>
    </div>

    <!-- 右下角经纬度显示 -->
    <div
      v-if="mouseLng !== null && mouseLat !== null"
      id="mousePosition"
    >
      经度: {{ mouseLng }}°　纬度: {{ mouseLat }}°
    </div>

    <!-- 底部时间滑动块 -->
    <div id="bottomTimeline">
      <div class="timeline-row">
        <div class="timeline-text">{{ timelineStartText }}</div>
        <el-tooltip
          content="场景内容未加载完成,请等待加载完成后再进行拖动"
          placement="top"
          :disabled="sceneContentLoaded && !sceneLoadedModalVisible"
        >
          <div
            class="timeline-slider-wrap"
            @mousedown="startTimelineDrag"
            @touchstart.passive="startTimelineDrag"
          >
          <div
            v-if="(isTimelineDragging || isPlaying) && timelineTooltipText"
            class="timeline-drag-tooltip"
            :style="{ left: timelineValue + '%' }"
          >
            {{ timelineTooltipText }}
          </div>
          <el-slider
            v-model="timelineValue"
            :disabled="!sceneContentLoaded || sceneLoadedModalVisible"
            :min="0"
            :max="100"
            :step="timelineStep"
            :show-tooltip="false"
            @input="onTimelineInput"
            @change="endTimelineDrag"
          />
          </div>
        </el-tooltip>
        <div class="timeline-text">{{ timelineEndText }}</div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="contextMenuVisible"
      id="contextMenu"
      :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }"
    >
      <div class="context-menu-item" @click="startDrawVoyagePath()">手动绘制航迹</div>
      <div class="context-menu-item" @click="startDrawPolygon()">手动绘制多边形</div>
      <div class="context-menu-item" @click="startDrawCircle()">手动绘制圆形</div>
      <div class="context-menu-item" @click="mapTool.drawingSector()">手动绘制扇形</div>
      <div class="context-menu-item" @click="startDrawEllipse()">手动绘制椭圆形</div>
      <div
        v-if="hasSelectedBattleRange"
        class="context-menu-item"
        @click="toggleSelectedBattleRangeFromMenu()"
      >
        {{ selectedBattleRangeMenuText }}
      </div>
      <div
        v-if="hasSelectedSignalSource"
        class="context-menu-item"
        @click="toggleSelectedSignalSourceFromMenu()"
      >
        {{ selectedSignalSourceMenuText }}
      </div>
      <div
        v-if="hasSelectedDetectionRange"
        class="context-menu-item"
        @click="toggleSelectedDetectionRangeFromMenu()"
      >
        {{ selectedDetectionRangeMenuText }}
      </div>
      <div class="context-menu-item" @click="mapTool.clearDrawShapes()">清除标绘</div>
    </div>

    <!-- 绘制航迹提示 -->
    <div v-if="isDrawingPath" id="drawingHint">
      正在绘制航迹：左键点击地图添加点，右键或ESC结束绘制
    </div>

    <!-- 场景内容加载完成提示：居中常驻 -->
    <div v-if="sceneLoadedModalVisible" class="scene-loaded-mask">
      <div class="scene-loaded-card">
        <div class="scene-loaded-title">提示</div>
        <div class="scene-loaded-text">场景内容已加载完成，可以进行播放</div>
        <div class="scene-loaded-actions">
          <el-button type="primary" size="small" @click="sceneLoadedModalVisible = false">知道了</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
#cesiumContainer {
  position: relative;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  .drawer {
    display: flex;
    flex-direction: column;
    position: fixed;
    flex: 1 1 auto;
    top: 0;
    left: 0;
    word-wrap: break-word;
    background-color: #ffffff78;
    background-clip: border-box;
    border-radius: 0.25rem;
    height: 87%;
    width: 22%;
    border-width: 0;
    box-shadow: 0 2px 6px 0 rgba(114, 124, 245, 0.5);
    padding: 4px 4px 8px 4px;
    z-index: 1;
  }
  .show {
    position: fixed;
    z-index: 2;
    top: 0;
    left: 21%;
    transition: all 1.2s;
    color: chocolate;
  }
  .show label {
    height: 1em;
  }
  #show_check:checked ~ .show {
    left: 0;
    transform: rotateY(180deg);
  }
  #show_check:checked ~ .drawer {
    translate: -200px;
    visibility: hidden;
    opacity: 0;
  }
  #show_check {
    display: none;
  }
  .drawer {
    transition: all 1.2s;
  }
  #menuList {
    position: absolute;
    color: white;
    z-index: 3;
    // top: 50%;
    left: 50%;
    bottom: 40px;
    transform: translate(-50%, -50%);
    .menu {
      display: flex;
      .content-item {
        padding: 5px 10px;
        cursor: pointer;
        .label {
          font-size: 26px;
        }
        .describe {
          font-size: 12px;
        }
      }
    }
  }
  #mapSourceSwitch {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 4;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 12px;
    .switch-group {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }
    .map-source-label {
      color: white;
      font-size: 12px;
      background-color: rgba(0, 0, 0, 0.5);
      padding: 4px 8px;
      border-radius: 4px;
    }
  }
  #mousePosition {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 4;
    padding: 4px 8px;
    border-radius: 4px;
    background-color: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 12px;
    pointer-events: none;
  }
  #bottomTimeline {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    z-index: 4;
    width: min(900px, 70vw);
    padding: 6px 12px;
    border-radius: 6px;
    background-color: rgba(0, 0, 0, 0.35);
    pointer-events: auto;
    .timeline-row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 10px;
    }
    .timeline-text {
      color: #fff;
      font-size: 12px;
      line-height: 1;
      background-color: rgba(0, 0, 0, 0.35);
      padding: 4px 6px;
      border-radius: 4px;
      white-space: nowrap;
      user-select: none;
      pointer-events: none;
    }

    .timeline-slider-wrap {
      position: relative;
      width: 100%;
      padding: 0 6px;
    }

    .timeline-drag-tooltip {
      position: absolute;
      top: -34px;
      transform: translateX(-50%);
      padding: 4px 8px;
      font-size: 12px;
      line-height: 1;
      color: #fff;
      background: rgba(0, 0, 0, 0.75);
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 10;
    }

    .timeline-drag-tooltip::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -6px;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid rgba(0, 0, 0, 0.75);
    }
  }
  #contextMenu {
    position: absolute;
    z-index: 10;
    background-color: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    min-width: 150px;
    .context-menu-item {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 14px;
      color: #333;
      &:hover {
        background-color: #f5f5f5;
      }
      &:not(:last-child) {
        border-bottom: 1px solid #eee;
      }
    }
  }
  #drawingHint {
    position: absolute;
    top: 10%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 10;
    padding: 12px 20px;
    background-color: rgba(0, 0, 0, 0.7);
    color: #fff;
    border-radius: 4px;
    font-size: 14px;
    pointer-events: none;
  }
  #entityInfoPanel {
    position: absolute;
    top: 80px;
    right: 10px;
    z-index: 4;
    min-width: 220px;
    padding: 10px 14px;
    border-radius: 6px;
    background-color: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  }
  #entityInfoPanel .entity-info-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    padding-bottom: 4px;
  }
  #entityInfoPanel .entity-info-row {
    display: flex;
    margin: 2px 0;
  }
  #entityInfoPanel .entity-info-row .label {
    width: 100px;
    color: #ddd;
  }
  #entityInfoPanel .entity-info-row .value {
    flex: 1;
    word-break: break-all;
  }

  .scene-loaded-mask {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.25);
    pointer-events: auto;
  }
  .scene-loaded-card {
    min-width: 360px;
    max-width: min(520px, 92vw);
    padding: 16px 18px;
    border-radius: 10px;
    background: rgba(20, 20, 20, 0.88);
    color: #fff;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(6px);
  }
  .scene-loaded-title {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .scene-loaded-text {
    font-size: 13px;
    line-height: 1.6;
    opacity: 0.95;
  }
  .scene-loaded-actions {
    margin-top: 14px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
}
</style>

