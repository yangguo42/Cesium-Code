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

// 时间播放控制
const isPlaying = ref(false);

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

let dragDebounceTimer: number | null = null;
const isTimelineDragging = ref(false);
let timelineSyncRaf: number | null = null;

const timelineTooltipText = computed(() => 
  mapTool.formatTimelineTooltip(timelineValue.value,timelineStartText.value,timelineEndText.value)
);

function startTimelineDrag() {
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

//固定站信息
export interface StationsInfo{
  stations: {
    lon: number; //经度
    lat: number; //纬度
    alt?: number; //高度(米)，默认 0
    image: string; //图片路径
    name: string; //名称
    /** 能力探测范围(雷达范围)参数 */
    detectionRange?: {
      radius: number; // 半径（米）
      startAngle: number; // 起始角（度，相对于正北顺时针）
      endAngle: number; // 终止角（度，相对于正北顺时针）
      color?: Cesium.Color | string; //扇形颜色，默认红色
    }
    /** 火力范围参数 */
    fireRange?: {
      radius: number; // 半径（米）
      color?: Cesium.Color | string; //圆形颜色，默认红色
    }
    /** 信号源参数 */
    signalSource?: {
      distance: number;  /** 扩散最大距离（米） */
      color?: Cesium.Color | string; //圆形颜色，默认红色
    }
  }[];
  labelFont?: string; //标签字体，默认 "12pt 微软雅黑"
}

//运动实体信息
export interface MovingStationInfo{
  name: string; // 实体名称
  /** 航迹点 */
  waypoints: {
    lon: number; //经度
    lat: number; //纬度
    height: number; //高度(米)，默认 0
  }[];
   /** 能力探测范围(雷达范围)参数 */
   detectionRange?: {
    radius: number; // 半径（米）
    startAngle: number; // 起始角（度，相对于正北顺时针）
    endAngle: number; // 终止角（度，相对于正北顺时针）
    color?: Cesium.Color | string; //扇形颜色，默认红色
  }
  /** 火力范围参数 */
  fireRange?: {
    radius: number; // 半径（米）
    color?: Cesium.Color | string; //圆形颜色，默认红色
  }
  /** 信号源参数 */
  signalSource?: {
    distance: number;  /** 扩散最大距离（米） */
    color?: Cesium.Color | string; //圆形颜色，默认红色
  }
  speed?: number; // 运动速度（米/秒），默认 100
  startTime: Date; // 航迹起始时间
  endTime: Date; //航迹结束时间
  imageUrl: string; // 实体贴图路径
  trackColor: Cesium.Color; // 航迹线颜色，默认红色
  trackWidth: number; // 航迹线宽度 默认2
  labelFont?: string; //标签字体，默认 "12pt 微软雅黑"
}



//测试数据
function test(){

      const startTime = new Date("2026-03-12T10:00:00");
      const endTime = new Date("2026-03-16T10:00:00");

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

      let stationEntity: Cesium.Entity | undefined;
      //固定站信息
      const fixedStationParams = {
        stations: [
          {
            lon: 108.92,
            lat: 18.30,
            alt: 0,
            image: "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzcyNjExOTQzMDAxIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjE5OTciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+PHBhdGggZD0iTTgwOC4zMiAxMjYuOGEyOS42OSAyOS42OSAwIDEgMCAyMSA4LjY4IDI5LjY2IDI5LjY2IDAgMCAwLTIxLTguNjh6IG0tODMuMTkgNjEuNDdINDYyLjRsMTM2LjA2IDEzNi4wMiAxMjkuNDgtMTI5LjQ3cS0xLjU0LTMuMjMtMi44MS02LjU1eiBtNDQuNzkgNDguNDlMNjQwLjQxIDM2Ni4yNWwxMzYuMTIgMTM2LjEyVjIzOS41OXEtMy4zNy0xLjI3LTYuNjEtMi44M3ogbS0zMzkuMzMgMjk3LjRhMjM1LjY2IDIzNS42NiAwIDAgMCAxNjcuODggNjkuNTYgMjkuNjkgMjkuNjkgMCAxIDEgMCA1OS4zNyAyOTQuODEgMjk0LjgxIDAgMCAxLTIwOS44NC04Ni45NCAyOS42OCAyOS42OCAwIDAgMSA0Mi00MnogbS0xMDQtMzk3LjgzYy0xMTguMzcgMTM5Ljc4LTExMS42NSAzNTAgMjAuMTIgNDgxLjc5YTM1My41MiAzNTMuNTIgMCAwIDAgMTY2LjA4IDk0IDI4LjY4IDI4LjY4IDAgMCAxIDYuODIgMS41NiAzNTAuMzMgMzUwLjMzIDAgMCAwIDc4LjkgOC43M2M4NS4xNyAwIDE2NS43Ni0yOS42NyAyMzAtODQuMTdsLTI1MS0yNTAuOTVjLTAuMy0wLjMtMC41OS0wLjYtMC44OC0wLjkxeiBtLTIzIDUyMi41NkwxNDguMjQgOTAwLjQ4aDMzMS41MVY3NjQuNjdBNDEyLjkgNDEyLjkgMCAwIDEgMzA0LjcgNjYwLjA4eiBtNDMuMDktNTg2LjM4bDU2LjM4IDU2LjM5aDMyMC41N2E4OC42OSA4OC42OSAwIDAgMSAxNy43LTMxLjA5bDQtNC4zMmE4OS4wNSA4OS4wNSAwIDEgMSA5MC41NiAxNDcuNnYzMjAuNjRsNTYuNCA1Ni4zOWEyOS42OSAyOS42OSAwIDAgMSAwIDQyIDQxMi44NiA0MTIuODYgMCAwIDEtMjkzLjgxIDEyMS43IDQyMi43NCA0MjIuNzQgMCAwIDEtNTkuMzItNC4xN3YxMjIuODZoMzkxYTI5LjY4IDI5LjY4IDAgMSAxIDAgNTkuMzZINTE5LjYyYTI5LjU4IDI5LjU4IDAgMCAxLTUuMS0wLjQzIDI5IDI5IDAgMCAxLTUuMDcgMC40M0g5My44NmEyOS43MSAyOS43MSAwIDAgMS0yNS00NS43OWwxOTQuMzUtMzAyLjNDMTQ0LjE5IDQ0OS4zMSAxNTggMjE5LjI1IDMwNC43IDcyLjUxYTMwLjU0IDMwLjU0IDAgMCAxIDQxLjk4IDB6IiBmaWxsPSIjNDY0NjQ2IiBwLWlkPSIxOTk4Ij48L3BhdGg+PC9zdmc+",
            name: "雷达站",
            detectionRange: {
              radius: 1000000,
              startAngle: 95,
              endAngle: 155,
              color: "green",
            },
            fireRange: {
              radius: 1000000,
              color: Cesium.Color.RED,
            },
            signalSource: {
              distance: 1000000,
              color: Cesium.Color.RED,
            },
          },
        ],
        labelFont: "12pt 微软雅黑",
      }
      fixedStationParams.stations.forEach((station) => {
        // 绘制固定站实体（单站点参数）
         stationEntity = mapTool.drawFixedStation({
          lon: station.lon,
          lat: station.lat,
          alt: station.alt,
          image: station.image,
          name: station.name,
          labelFont: fixedStationParams.labelFont,
        });

        // 绘制能力探测范围（依赖实体 id 用于管理）
        if (station.detectionRange) {
          const center = Cesium.Cartesian3.fromDegrees(station.lon, station.lat, station.alt ?? 0);
          mapTool.detectionRange({
            scanEnabled: true,
            scanPeriodSeconds: 3,
            center,
            ownerId: stationEntity?.id ?? "",
            name: `${station.name}-能力探测范围(雷达范围)`,
            height: 0,
            ...station.detectionRange,
          });
        }

        //绘制火力范围
        // if (station.fireRange) {
        //   const center = Cesium.Cartesian3.fromDegrees(station.lon, station.lat, station.alt ?? 0);
        //   mapTool.drawFireControlRangeCircle({
        //     center,
        //     ownerId: stationEntity?.id ?? "",
        //     name: `${station.name}-火力范围`,
        //     ...station.fireRange,
        //   });
        // }

        // if (station.signalSource) {
        //   mapTool.drawSignalRipple({
        //     center: stationEntity?.position ?? Cesium.Cartesian3.ZERO,
        //     ownerId: stationEntity?.id ?? "",
        //     namePrefix: `${station.name}-信号源扩散波纹`,
        //     rippleColor: "blue",
        //     ...station.signalSource,
        //   });
        // }
      });

      const movingStationParams: mapTool.MovingStationParams = {
        name: "MQ-9无人机",
        waypoints:[
    {
        "lon": 105.9674330119713,
        "lat": 4.124824696669024,
        "height": 18000
    },
    {
        "lon": 106.01254334299725,
        "lat": 4.237111374543051,
        "height": 18000
    },
    {
        "lon": 106.08636448794348,
        "lat": 4.412528164730308,
        "height": 18000
    },
    {
        "lon": 106.1828596371804,
        "lat": 4.637255546056656,
        "height": 18000
    },
    {
        "lon": 106.2959879988137,
        "lat": 4.897465950503224,
        "height": 18000
    },
    {
        "lon": 106.41969581833598,
        "lat": 5.179322271441067,
        "height": 18000
    },
    {
        "lon": 106.5479104336796,
        "lat": 5.468981518872424,
        "height": 18000
    },
    {
        "lon": 106.67453728568753,
        "lat": 5.752601993746826,
        "height": 18000
    },
    {
        "lon": 106.79345974507444,
        "lat": 6.016351411651892,
        "height": 18000
    },
    {
        "lon": 106.89854158959635,
        "lat": 6.246413056844,
        "height": 18000
    },
    {
        "lon": 106.98363197112836,
        "lat": 6.428987294549053,
        "height": 18000
    },
    {
        "lon": 107.04879066370461,
        "lat": 6.5696302197008585,
        "height": 18000
    },
    {
        "lon": 107.1003963540491,
        "lat": 6.685757272761965,
        "height": 18000
    },
    {
        "lon": 107.14177475712701,
        "lat": 6.781364672831494,
        "height": 18000
    },
    {
        "lon": 107.17625691982161,
        "lat": 6.860444374849018,
        "height": 18000
    },
    {
        "lon": 107.20717791777207,
        "lat": 6.926985015637123,
        "height": 18000
    },
    {
        "lon": 107.23787594862297,
        "lat": 6.984972774235807,
        "height": 18000
    },
    {
        "lon": 107.27169179921975,
        "lat": 7.038391973737825,
        "height": 18000
    },
    {
        "lon": 107.3119686705898,
        "lat": 7.091225306210583,
        "height": 18000
    },
    {
        "lon": 107.3620523447105,
        "lat": 7.147453594296356,
        "height": 18000
    },
    {
        "lon": 107.42529167102175,
        "lat": 7.211055012853401,
        "height": 18000
    },
    {
        "lon": 107.50016056972446,
        "lat": 7.280796983243675,
        "height": 18000
    },
    {
        "lon": 107.58234463641958,
        "lat": 7.351864518384515,
        "height": 18000
    },
    {
        "lon": 107.6710119261093,
        "lat": 7.422859543876018,
        "height": 18000
    },
    {
        "lon": 107.76532892190187,
        "lat": 7.492384289332711,
        "height": 18000
    },
    {
        "lon": 107.8644603646264,
        "lat": 7.559041459384303,
        "height": 18000
    },
    {
        "lon": 107.96756914320322,
        "lat": 7.621434390919757,
        "height": 18000
    },
    {
        "lon": 108.07381624473472,
        "lat": 7.678167186208877,
        "height": 18000
    },
    {
        "lon": 108.18236076269795,
        "lat": 7.727844811707608,
        "height": 18000
    },
    {
        "lon": 108.29235996111464,
        "lat": 7.769073153246746,
        "height": 18000
    },
    {
        "lon": 108.4029693921528,
        "lat": 7.800459019918114,
        "height": 18000
    },
    {
        "lon": 108.5152790199725,
        "lat": 7.820118165647919,
        "height": 18000
    },
    {
        "lon": 108.63076008938334,
        "lat": 7.828445821240115,
        "height": 18000
    },
    {
        "lon": 108.74914025381186,
        "lat": 7.827468879886357,
        "height": 18000
    },
    {
        "lon": 108.87014917243017,
        "lat": 7.819214495739248,
        "height": 18000
    },
    {
        "lon": 108.99351871509484,
        "lat": 7.8057100805671,
        "height": 18000
    },
    {
        "lon": 109.1189831408684,
        "lat": 7.78898330357336,
        "height": 18000
    },
    {
        "lon": 109.24627925020401,
        "lat": 7.771062092455443,
        "height": 18000
    },
    {
        "lon": 109.3751465109098,
        "lat": 7.7539746377234815,
        "height": 18000
    },
    {
        "lon": 109.50532715803722,
        "lat": 7.739749404768869,
        "height": 18000
    },
    {
        "lon": 109.63656626786339,
        "lat": 7.7304151591665775,
        "height": 18000
    },
    {
        "lon": 109.77110655765003,
        "lat": 7.717677684644554,
        "height": 18000
    },
    {
        "lon": 109.91045290760076,
        "lat": 7.69482072536937,
        "height": 18000
    },
    {
        "lon": 110.05324985222222,
        "lat": 7.666241533398881,
        "height": 18000
    },
    {
        "lon": 110.19814791279994,
        "lat": 7.63633911825343,
        "height": 18000
    },
    {
        "lon": 110.34380410115988,
        "lat": 7.609514219335968,
        "height": 18000
    },
    {
        "lon": 110.48888214361025,
        "lat": 7.590169248326297,
        "height": 18000
    },
    {
        "lon": 110.63205241677944,
        "lat": 7.58270825934595,
        "height": 18000
    },
    {
        "lon": 110.77199158698934,
        "lat": 7.591536994594906,
        "height": 18000
    },
    {
        "lon": 110.90738194486084,
        "lat": 7.621063026325223,
        "height": 18000
    },
    {
        "lon": 111.03691042699752,
        "lat": 7.675695972449783,
        "height": 18000
    },
    {
        "lon": 111.16201211449754,
        "lat": 7.758003328465467,
        "height": 18000
    },
    {
        "lon": 111.28487690979925,
        "lat": 7.864843570769181,
        "height": 18000
    },
    {
        "lon": 111.40532253485799,
        "lat": 7.992064254053205,
        "height": 18000
    },
    {
        "lon": 111.52316122788365,
        "lat": 8.13551262141429,
        "height": 18000
    },
    {
        "lon": 111.63819988698992,
        "lat": 8.291035730974999,
        "height": 18000
    },
    {
        "lon": 111.75024024483544,
        "lat": 8.45448078467334,
        "height": 18000
    },
    {
        "lon": 111.85907907602885,
        "lat": 8.621695606164717,
        "height": 18000
    },
    {
        "lon": 111.96450843901515,
        "lat": 8.788529179146172,
        "height": 18000
    },
    {
        "lon": 112.06631595408577,
        "lat": 8.950832134247706,
        "height": 18000
    },
    {
        "lon": 112.16428511905829,
        "lat": 9.104457061952132,
        "height": 18000
    },
    {
        "lon": 112.25843629697142,
        "lat": 9.256079545574146,
        "height": 18000
    },
    {
        "lon": 112.34900478242265,
        "lat": 9.413716861995908,
        "height": 18000
    },
    {
        "lon": 112.43609112565309,
        "lat": 9.575234663006158,
        "height": 18000
    },
    {
        "lon": 112.51979282285612,
        "lat": 9.73849726942472,
        "height": 18000
    },
    {
        "lon": 112.60020458980796,
        "lat": 9.90136776049194,
        "height": 18000
    },
    {
        "lon": 112.67741862169031,
        "lat": 10.061708147616052,
        "height": 18000
    },
    {
        "lon": 112.75152483971894,
        "lat": 10.217379602441067,
        "height": 18000
    },
    {
        "lon": 112.82261112509129,
        "lat": 10.366242709317703,
        "height": 18000
    },
    {
        "lon": 112.8907635406751,
        "lat": 10.506157714086564,
        "height": 18000
    },
    {
        "lon": 112.9560665407736,
        "lat": 10.63498474462533,
        "height": 18000
    },
    {
        "lon": 113.01614556966388,
        "lat": 10.750427653121095,
        "height": 18000
    },
    {
        "lon": 113.06957742901027,
        "lat": 10.853435455642554,
        "height": 18000
    },
    {
        "lon": 113.11787649903597,
        "lat": 10.946734831925376,
        "height": 18000
    },
    {
        "lon": 113.16256170169666,
        "lat": 11.033050940067184,
        "height": 18000
    },
    {
        "lon": 113.2051557804162,
        "lat": 11.115107574503238,
        "height": 18000
    },
    {
        "lon": 113.24718485164908,
        "lat": 11.19562731454996,
        "height": 18000
    },
    {
        "lon": 113.29017822468566,
        "lat": 11.277331614461945,
        "height": 18000
    },
    {
        "lon": 113.33566848669318,
        "lat": 11.362940793732044,
        "height": 18000
    },
    {
        "lon": 113.38519185015716,
        "lat": 11.455173889037063,
        "height": 18000
    },
    {
        "lon": 113.44028875963996,
        "lat": 11.556748326805366,
        "height": 18000
    },
    {
        "lon": 113.50544663208089,
        "lat": 11.663449114311515,
        "height": 18000
    },
    {
        "lon": 113.58157547132902,
        "lat": 11.770109167335026,
        "height": 18000
    },
    {
        "lon": 113.66485014164326,
        "lat": 11.878018599798915,
        "height": 18000
    },
    {
        "lon": 113.75144167267968,
        "lat": 11.988471598262311,
        "height": 18000
    },
    {
        "lon": 113.83751733579055,
        "lat": 12.10276724785702,
        "height": 18000
    },
    {
        "lon": 113.91924026995915,
        "lat": 12.222209897450083,
        "height": 18000
    },
    {
        "lon": 113.99276860388579,
        "lat": 12.348109038775883,
        "height": 18000
    },
    {
        "lon": 114.05425402130315,
        "lat": 12.481778667887463,
        "height": 18000
    },
    {
        "lon": 114.09983972645323,
        "lat": 12.62453608535043,
        "height": 18000
    },
    {
        "lon": 114.12565778586317,
        "lat": 12.777700074017595,
        "height": 18000
    },
    {
        "lon": 114.12960898683545,
        "lat": 12.947024294485384,
        "height": 18000
    },
    {
        "lon": 114.11449564270197,
        "lat": 13.134348375635794,
        "height": 18000
    },
    {
        "lon": 114.08379355562649,
        "lat": 13.33511556520984,
        "height": 18000
    },
    {
        "lon": 114.04098542838422,
        "lat": 13.544765221167806,
        "height": 18000
    },
    {
        "lon": 113.98956552728846,
        "lat": 13.758735040561938,
        "height": 18000
    },
    {
        "lon": 113.9330429730107,
        "lat": 13.972463343004966,
        "height": 18000
    },
    {
        "lon": 113.87494364069066,
        "lat": 14.181391188815384,
        "height": 18000
    },
    {
        "lon": 113.81881066501398,
        "lat": 14.38096406783363,
        "height": 18000
    },
    {
        "lon": 113.76820355543911,
        "lat": 14.566632882040867,
        "height": 18000
    },
    {
        "lon": 113.72669593122701,
        "lat": 14.73385396347929,
        "height": 18000
    },
    {
        "lon": 113.69156136195778,
        "lat": 14.881812319081657,
        "height": 18000
    },
    {
        "lon": 113.6575993790062,
        "lat": 15.014773751162751,
        "height": 18000
    },
    {
        "lon": 113.6246791628195,
        "lat": 15.13581873653654,
        "height": 18000
    },
    {
        "lon": 113.59266749942722,
        "lat": 15.248026938269833,
        "height": 18000
    },
    {
        "lon": 113.56142895750946,
        "lat": 15.354477214067346,
        "height": 18000
    },
    {
        "lon": 113.5308260308083,
        "lat": 15.458247683344048,
        "height": 18000
    },
    {
        "lon": 113.50071924468905,
        "lat": 15.562415794519813,
        "height": 18000
    },
    {
        "lon": 113.47096722576497,
        "lat": 15.67005834355549,
        "height": 18000
    },
    {
        "lon": 113.44142673356475,
        "lat": 15.78425139918748,
        "height": 18000
    },
    {
        "lon": 113.4119526532476,
        "lat": 15.908070089730007,
        "height": 18000
    },
    {
        "lon": 113.38133224062447,
        "lat": 16.042092720946744,
        "height": 18000
    },
    {
        "lon": 113.34903487597832,
        "lat": 16.183452318487575,
        "height": 18000
    },
    {
        "lon": 113.31593983978902,
        "lat": 16.330055059408718,
        "height": 18000
    },
    {
        "lon": 113.2829302910149,
        "lat": 16.479807068855227,
        "height": 18000
    },
    {
        "lon": 113.25089355423258,
        "lat": 16.630614573163612,
        "height": 18000
    },
    {
        "lon": 113.22072120976897,
        "lat": 16.780384073825335,
        "height": 18000
    },
    {
        "lon": 113.19330898522321,
        "lat": 16.927022510004548,
        "height": 18000
    },
    {
        "lon": 113.16955644659555,
        "lat": 17.068437376737613,
        "height": 18000
    },
    {
        "lon": 113.15036648712518,
        "lat": 17.202536767395085,
        "height": 18000
    },
    {
        "lon": 113.13664461188357,
        "lat": 17.327229312465423,
        "height": 18000
    },
    {
        "lon": 113.12437994317604,
        "lat": 17.441883672553473,
        "height": 18000
    },
    {
        "lon": 113.11041214570402,
        "lat": 17.54831981314276,
        "height": 18000
    },
    {
        "lon": 113.09692768656315,
        "lat": 17.648124085961133,
        "height": 18000
    },
    {
        "lon": 113.08611738226558,
        "lat": 17.742883422716307,
        "height": 18000
    },
    {
        "lon": 113.0801759516048,
        "lat": 17.834185122792405,
        "height": 18000
    },
    {
        "lon": 113.08130195543947,
        "lat": 17.92361641708265,
        "height": 18000
    },
    {
        "lon": 113.09169812579313,
        "lat": 18.012763788456624,
        "height": 18000
    },
    {
        "lon": 113.11357208257499,
        "lat": 18.10321202929875,
        "height": 18000
    },
    {
        "lon": 113.14913743056995,
        "lat": 18.196543013853717,
        "height": 18000
    },
    {
        "lon": 113.2006152220729,
        "lat": 18.294334157796268,
        "height": 18000
    },
    {
        "lon": 113.27019371421095,
        "lat": 18.399049260727498,
        "height": 18000
    },
    {
        "lon": 113.35683252624776,
        "lat": 18.510402924690506,
        "height": 18000
    },
    {
        "lon": 113.45791048896396,
        "lat": 18.625843999094506,
        "height": 18000
    },
    {
        "lon": 113.57079600006266,
        "lat": 18.7428226871962,
        "height": 18000
    },
    {
        "lon": 113.69284453079652,
        "lat": 18.858792620766195,
        "height": 18000
    },
    {
        "lon": 113.82139699426298,
        "lat": 18.97121268255882,
        "height": 18000
    },
    {
        "lon": 113.9537789724207,
        "lat": 19.0775485050304,
        "height": 18000
    },
    {
        "lon": 114.08730078837803,
        "lat": 19.175273564963753,
        "height": 18000
    },
    {
        "lon": 114.21925840187018,
        "lat": 19.261869792467806,
        "height": 18000
    },
    {
        "lon": 114.3469350992915,
        "lat": 19.33482761917492,
        "height": 18000
    },
    {
        "lon": 114.47215910615138,
        "lat": 19.390524180263657,
        "height": 18000
    },
    {
        "lon": 114.5987178633528,
        "lat": 19.429549465420287,
        "height": 18000
    },
    {
        "lon": 114.72683398602157,
        "lat": 19.455718720909786,
        "height": 18000
    },
    {
        "lon": 114.8567417031392,
        "lat": 19.47284633283183,
        "height": 18000
    },
    {
        "lon": 114.98868709881897,
        "lat": 19.484745770553992,
        "height": 18000
    },
    {
        "lon": 115.12292845679889,
        "lat": 19.495229580899228,
        "height": 18000
    },
    {
        "lon": 115.2597367174839,
        "lat": 19.508109401671863,
        "height": 18000
    },
    {
        "lon": 115.39939605723615,
        "lat": 19.527195975629933,
        "height": 18000
    },
    {
        "lon": 115.54220460018985,
        "lat": 19.55629914889511,
        "height": 18000
    },
    {
        "lon": 115.68847527368925,
        "lat": 19.59922783103711,
        "height": 18000
    },
    {
        "lon": 115.84236413957134,
        "lat": 19.65601827608141,
        "height": 18000
    },
    {
        "lon": 116.00590666544268,
        "lat": 19.72271716432465,
        "height": 18000
    },
    {
        "lon": 116.17623832198448,
        "lat": 19.797154471754105,
        "height": 18000
    },
    {
        "lon": 116.35048154168432,
        "lat": 19.877169426763892,
        "height": 18000
    },
    {
        "lon": 116.52574394898063,
        "lat": 19.960611537863752,
        "height": 18000
    },
    {
        "lon": 116.69911746834691,
        "lat": 20.04534130010972,
        "height": 18000
    },
    {
        "lon": 116.8676782603519,
        "lat": 20.129230509563513,
        "height": 18000
    },
    {
        "lon": 117.02848743406774,
        "lat": 20.210162109436258,
        "height": 18000
    },
    {
        "lon": 117.17859248578469,
        "lat": 20.286029492352114,
        "height": 18000
    },
    {
        "lon": 117.31502941915471,
        "lat": 20.354735190226638,
        "height": 18000
    },
    {
        "lon": 117.43571477604048,
        "lat": 20.418951138946444,
        "height": 18000
    },
    {
        "lon": 117.54253296233199,
        "lat": 20.482377729049954,
        "height": 18000
    },
    {
        "lon": 117.63846713039479,
        "lat": 20.54445798510124,
        "height": 18000
    },
    {
        "lon": 117.72650377952235,
        "lat": 20.604625870596415,
        "height": 18000
    },
    {
        "lon": 117.80963285767689,
        "lat": 20.66230777563313,
        "height": 18000
    },
    {
        "lon": 117.89084766952328,
        "lat": 20.71692352203209,
        "height": 18000
    },
    {
        "lon": 117.97314454689975,
        "lat": 20.76788687893347,
        "height": 18000
    },
    {
        "lon": 118.05952224531477,
        "lat": 20.814605582543162,
        "height": 18000
    },
    {
        "lon": 118.15298103309063,
        "lat": 20.856480855722904,
        "height": 18000
    },
    {
        "lon": 118.25652143838599,
        "lat": 20.89290642660859,
        "height": 18000
    },
    {
        "lon": 118.37168426345696,
        "lat": 20.923149003933116,
        "height": 18000
    },
    {
        "lon": 118.49620664954274,
        "lat": 20.947408535541918,
        "height": 18000
    },
    {
        "lon": 118.62738144048564,
        "lat": 20.966476724150198,
        "height": 18000
    },
    {
        "lon": 118.76250064234966,
        "lat": 20.98115242766965,
        "height": 18000
    },
    {
        "lon": 118.89885664531509,
        "lat": 20.992242587753058,
        "height": 18000
    },
    {
        "lon": 119.03374324085495,
        "lat": 21.00056269106544,
        "height": 18000
    },
    {
        "lon": 119.16445639350754,
        "lat": 21.006936769418086,
        "height": 18000
    },
    {
        "lon": 119.28829472546481,
        "lat": 21.012196948352216,
        "height": 18000
    },
    {
        "lon": 119.40255967444779,
        "lat": 21.01718255562895,
        "height": 18000
    },
    {
        "lon": 119.50455529086713,
        "lat": 21.022738801265863,
        "height": 18000
    },
    {
        "lon": 119.59326520119197,
        "lat": 21.027614263929635,
        "height": 18000
    },
    {
        "lon": 119.67091610774439,
        "lat": 21.030263336987304,
        "height": 18000
    },
    {
        "lon": 119.73967966224401,
        "lat": 21.031088730536375,
        "height": 18000
    },
    {
        "lon": 119.80172886005977,
        "lat": 21.030487961640766,
        "height": 18000
    },
    {
        "lon": 119.85923760871866,
        "lat": 21.028854358073826,
        "height": 18000
    },
    {
        "lon": 119.9143804275046,
        "lat": 21.026577787940916,
        "height": 18000
    },
    {
        "lon": 119.9693322608538,
        "lat": 21.02404511154326,
        "height": 18000
    },
    {
        "lon": 120.02626839185208,
        "lat": 21.02164035297293,
        "height": 18000
    },
    {
        "lon": 120.08736444401522,
        "lat": 21.019744589560794,
        "height": 18000
    },
    {
        "lon": 120.15479645967471,
        "lat": 21.018735557465174,
        "height": 18000
    },
    {
        "lon": 120.22733311200145,
        "lat": 21.017351570649268,
        "height": 18000
    },
    {
        "lon": 120.3020323171573,
        "lat": 21.014495266637418,
        "height": 18000
    },
    {
        "lon": 120.37850523528381,
        "lat": 21.010788434277487,
        "height": 18000
    },
    {
        "lon": 120.45636426347782,
        "lat": 21.006853498340654,
        "height": 18000
    },
    {
        "lon": 120.5352231234384,
        "lat": 21.00331355180054,
        "height": 18000
    },
    {
        "lon": 120.61469691746547,
        "lat": 21.00079237887416,
        "height": 18000
    },
    {
        "lon": 120.69440215255251,
        "lat": 20.999914469661093,
        "height": 18000
    },
    {
        "lon": 120.77395673230548,
        "lat": 21.001305027227627,
        "height": 18000
    },
    {
        "lon": 120.85297991640235,
        "lat": 21.00558996792519,
        "height": 18000
    },
    {
        "lon": 120.93109224729439,
        "lat": 21.013395915611923,
        "height": 18000
    },
    {
        "lon": 121.00599226822115,
        "lat": 21.02386418190224,
        "height": 18000
    },
    {
        "lon": 121.07679893018096,
        "lat": 21.03587232241585,
        "height": 18000
    },
    {
        "lon": 121.14526509762143,
        "lat": 21.049649456524225,
        "height": 18000
    },
    {
        "lon": 121.21314477038933,
        "lat": 21.065421756365524,
        "height": 18000
    },
    {
        "lon": 121.2821932344498,
        "lat": 21.083412604953555,
        "height": 18000
    },
    {
        "lon": 121.35416730007688,
        "lat": 21.103842573376532,
        "height": 18000
    },
    {
        "lon": 121.43082561858589,
        "lat": 21.126929214528026,
        "height": 18000
    },
    {
        "lon": 121.51392906810246,
        "lat": 21.152886670155617,
        "height": 18000
    },
    {
        "lon": 121.60524119736202,
        "lat": 21.181925087168732,
        "height": 18000
    },
    {
        "lon": 121.70652871408589,
        "lat": 21.214249838133334,
        "height": 18000
    },
    {
        "lon": 121.81792519166864,
        "lat": 21.248924320513254,
        "height": 18000
    },
    {
        "lon": 121.9376872029738,
        "lat": 21.28519375475229,
        "height": 18000
    },
    {
        "lon": 122.06476972799511,
        "lat": 21.32353346488536,
        "height": 18000
    },
    {
        "lon": 122.198129418608,
        "lat": 21.36442098390172,
        "height": 18000
    },
    {
        "lon": 122.3367248018021,
        "lat": 21.408336495318483,
        "height": 18000
    },
    {
        "lon": 122.47951640759244,
        "lat": 21.455763224616128,
        "height": 18000
    },
    {
        "lon": 122.62546681781566,
        "lat": 21.507187782462655,
        "height": 18000
    },
    {
        "lon": 122.77354063104472,
        "lat": 21.563100461768688,
        "height": 18000
    },
    {
        "lon": 122.92270433805118,
        "lat": 21.623995490576235,
        "height": 18000
    },
    {
        "lon": 123.07192610159156,
        "lat": 21.690371242588686,
        "height": 18000
    },
    {
        "lon": 123.2269818965311,
        "lat": 21.762929511506574,
        "height": 18000
    },
    {
        "lon": 123.3921935157449,
        "lat": 21.841519588770353,
        "height": 18000
    },
    {
        "lon": 123.56434229931189,
        "lat": 21.92537208282323,
        "height": 18000
    },
    {
        "lon": 123.74019948360083,
        "lat": 22.013729315910645,
        "height": 18000
    },
    {
        "lon": 123.91652501311742,
        "lat": 22.105846570374688,
        "height": 18000
    },
    {
        "lon": 124.0900667826787,
        "lat": 22.200992777339362,
        "height": 18000
    },
    {
        "lon": 124.25756023707359,
        "lat": 22.29845060993394,
        "height": 18000
    },
    {
        "lon": 124.41572825395386,
        "lat": 22.397515940155742,
        "height": 18000
    },
    {
        "lon": 124.5612812399544,
        "lat": 22.497496617483336,
        "height": 18000
    },
    {
        "lon": 124.69091738022078,
        "lat": 22.597710528177814,
        "height": 18000
    },
    {
        "lon": 124.80425656319629,
        "lat": 22.699690852700236,
        "height": 18000
    },
    {
        "lon": 124.90448388793227,
        "lat": 22.805041915273694,
        "height": 18000
    },
    {
        "lon": 124.99363783359263,
        "lat": 22.913188086759135,
        "height": 18000
    },
    {
        "lon": 125.07375960368918,
        "lat": 23.023546521940418,
        "height": 18000
    },
    {
        "lon": 125.14689403510319,
        "lat": 23.135528308692855,
        "height": 18000
    },
    {
        "lon": 125.21509036124279,
        "lat": 23.248539383660695,
        "height": 18000
    },
    {
        "lon": 125.28040280484677,
        "lat": 23.361981210910585,
        "height": 18000
    },
    {
        "lon": 125.34489098049052,
        "lat": 23.475251217855543,
        "height": 18000
    },
    {
        "lon": 125.41062009001789,
        "lat": 23.58774298121547,
        "height": 18000
    },
    {
        "lon": 125.47966089590942,
        "lat": 23.69884615493632,
        "height": 18000
    },
    {
        "lon": 125.54972190770681,
        "lat": 23.809683562435126,
        "height": 18000
    },
    {
        "lon": 125.61744901273907,
        "lat": 23.921627570081075,
        "height": 18000
    },
    {
        "lon": 125.68328143407314,
        "lat": 24.03437635713526,
        "height": 18000
    },
    {
        "lon": 125.74760679488084,
        "lat": 24.147542239904716,
        "height": 18000
    },
    {
        "lon": 125.81076460867632,
        "lat": 24.260649659964884,
        "height": 18000
    },
    {
        "lon": 125.8730483493477,
        "lat": 24.373134710870357,
        "height": 18000
    },
    {
        "lon": 125.93470640289138,
        "lat": 24.48434680053341,
        "height": 18000
    },
    {
        "lon": 125.99594219377599,
        "lat": 24.59355303366687,
        "height": 18000
    },
    {
        "lon": 126.05691378321691,
        "lat": 24.69994584257779,
        "height": 18000
    },
    {
        "lon": 126.11773324755222,
        "lat": 24.802654283357025,
        "height": 18000
    },
    {
        "lon": 126.18308383206538,
        "lat": 24.90998321360756,
        "height": 18000
    },
    {
        "lon": 126.25507429765402,
        "lat": 25.02678651501722,
        "height": 18000
    },
    {
        "lon": 126.32999895897623,
        "lat": 25.147146469705937,
        "height": 18000
    },
    {
        "lon": 126.40430070260787,
        "lat": 25.26544042375099,
        "height": 18000
    },
    {
        "lon": 126.4746026766141,
        "lat": 25.376386594134644,
        "height": 18000
    },
    {
        "lon": 126.53771473844931,
        "lat": 25.475043885919884,
        "height": 18000
    },
    {
        "lon": 126.5906175748994,
        "lat": 25.55677202629163,
        "height": 18000
    },
    {
        "lon": 126.63042745633749,
        "lat": 25.617158052624596,
        "height": 18000
    },
    {
        "lon": 126.65958281024214,
        "lat": 25.656746724978728,
        "height": 18000
    }
],
      detectionRange: {
        radius: 1000000,
        startAngle: 0,
        endAngle: 30,
        color: "green",
      },
      fireRange: {
        radius: 1000000,
        color: Cesium.Color.RED,
      },
      signalSource: {
        distance: 1000000,
        color: "blue",
      },
        speed: 100,
        startTime: startTime,
        endTime: endTime,
        imageUrl: "./img/飞机.svg",
        trackWidth: 1,
        labelFont:"12pt 微软雅黑",
      }


      //侦察机运动实体信息
      const moveingEntity = mapTool.drawMovingStation(movingStationParams);

      // //绘制能力探测范围(雷达范围)扇形
      // if (movingStationParams.detectionRange && moveingEntity) {
      //   const dr = movingStationParams.detectionRange;
      //   mapTool.detectionRange({
      //     center: moveingEntity,
      //     radius: dr.radius,
      //     startAngle: dr.startAngle,
      //     endAngle: dr.endAngle,
      //     color: dr.color,
      //     height: dr.height,
      //     name: dr.name,
      //     scanEnabled: true,
      //     scanPeriodSeconds: 100,
      //     ownerId: moveingEntity?.id ?? "",
      //   });
      // }
      //绘制火力范围（跟随运动实体）
      // if (movingStationParams.fireRange && moveingEntity) {
      //   const fr = movingStationParams.fireRange;
      //   const center = moveingEntity.position;
      //   if (!center) return;
      //   mapTool.drawFireControlRangeCircle({
      //     center: center,
      //     radius: fr.radius,
      //     color: fr.color,
      //     height: fr.height,
      //     name: fr.name,
      //     ownerId: moveingEntity.id,
      //   });
      // }

      //绘制信号源扩散波纹（跟随运动实体）
      if (movingStationParams.signalSource && moveingEntity) {
        const sr = movingStationParams.signalSource;
        mapTool.drawSignalRipple({
          center: moveingEntity,
          distance: sr.distance,
          rippleColor: sr.color,
          height: sr.height,
          namePrefix: sr.namePrefix,
          ownerId: moveingEntity.id,
        });
      }

      if (stationEntity && moveingEntity) {
        mapTool.signalSourceInteraction(stationEntity, moveingEntity, 1000);
      }


      //航母运动实体信息
      const carrierMovingStationParams: mapTool.MovingStationParams = {
        name: "林肯号航空母舰",
        waypoints: [
    {
        "lon": 108.54943902657162,
        "lat": 4.019602411701537,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 108.56726515672135,
        "lat": 4.067926358321208,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 108.61108129944374,
        "lat": 4.160552190796494,
        "height": 0
    },
    {
        "lon": 108.67620251402732,
        "lat": 4.288839333831504,
        "height": 0
    },
    {
        "lon": 108.75794565688722,
        "lat": 4.444146368995765,
        "height": 0
    },
    {
        "lon": 108.85162443027609,
        "lat": 4.617830212140181,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 108.95254577688793,
        "lat": 4.801246648632943,
        "height": 0
    },
    {
        "lon": 109.05600761110544,
        "lat": 4.985751998591838,
        "height": 0
    },
    {
        "lon": 109.15729783593416,
        "lat": 5.1627053292023755,
        "height": 0
    },
    {
        "lon": 109.25169456874077,
        "lat": 5.323470436513753,
        "height": 0
    },
    {
        "lon": 109.33446748913907,
        "lat": 5.459416785601887,
        "height": 0
    },
    {
        "lon": 109.40513333279074,
        "lat": 5.578321109864594,
        "height": 0
    },
    {
        "lon": 109.46831922851356,
        "lat": 5.693458674268958,
        "height": 0
    },
    {
        "lon": 109.52695708736995,
        "lat": 5.804449798237585,
        "height": 0
    },
    {
        "lon": 109.58398094790749,
        "lat": 5.910913648035203,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 109.64232690226959,
        "lat": 6.01246824983927,
        "height": 0
    },
    {
        "lon": 109.70493299292909,
        "lat": 6.108730368005069,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 109.77473905776655,
        "lat": 6.199315231534438,
        "height": 1.1641532182693481e-10
    },
    {
        "lon": 109.85468649921484,
        "lat": 6.283836095748929,
        "height": 0
    },
    {
        "lon": 109.94771794686838,
        "lat": 6.361903631041749,
        "height": 0
    },
    {
        "lon": 110.05677677230075,
        "lat": 6.433125136372558,
        "height": 0
    },
    {
        "lon": 110.18683674412217,
        "lat": 6.494088502124114,
        "height": 0
    },
    {
        "lon": 110.33761214787964,
        "lat": 6.543289012167529,
        "height": 0
    },
    {
        "lon": 110.50415490719784,
        "lat": 6.583193961684219,
        "height": 1.1641532182693481e-10
    },
    {
        "lon": 110.68151504049126,
        "lat": 6.616275005189389,
        "height": 0
    },
    {
        "lon": 110.86474225232647,
        "lat": 6.645009760543035,
        "height": 0
    },
    {
        "lon": 111.048887405387,
        "lat": 6.671882782758872,
        "height": 0
    },
    {
        "lon": 111.22900371505705,
        "lat": 6.699385943416108,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 111.4001474845646,
        "lat": 6.730018278210738,
        "height": 0
    },
    {
        "lon": 111.5573781953398,
        "lat": 6.766285373810216,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 111.69575778448277,
        "lat": 6.81069835536048,
        "height": 0
    },
    {
        "lon": 111.81771250804388,
        "lat": 6.8559706230544615,
        "height": 0
    },
    {
        "lon": 111.92970883521245,
        "lat": 6.895464432063809,
        "height": 0
    },
    {
        "lon": 112.03287373192303,
        "lat": 6.932666415853719,
        "height": 0
    },
    {
        "lon": 112.1283384150934,
        "lat": 6.971061771628961,
        "height": 0
    },
    {
        "lon": 112.2172375821749,
        "lat": 7.0141344607240566,
        "height": 0
    },
    {
        "lon": 112.30070886425966,
        "lat": 7.065367488830537,
        "height": -1.0477378964424133e-9
    },
    {
        "lon": 112.37989249479358,
        "lat": 7.128243220181086,
        "height": 0
    },
    {
        "lon": 112.45593118719863,
        "lat": 7.20624367400977,
        "height": 0
    },
    {
        "lon": 112.52997021588422,
        "lat": 7.3028507373643565,
        "height": 0
    },
    {
        "lon": 112.6031576962091,
        "lat": 7.421546205647998,
        "height": 0
    },
    {
        "lon": 112.6747540469273,
        "lat": 7.568340616674195,
        "height": 0
    },
    {
        "lon": 112.74317319967349,
        "lat": 7.7429684406902615,
        "height": 0
    },
    {
        "lon": 112.80829184419424,
        "lat": 7.93949553315053,
        "height": 0
    },
    {
        "lon": 112.8699815118759,
        "lat": 8.15198540650574,
        "height": 0
    },
    {
        "lon": 112.92810897396448,
        "lat": 8.374499688936305,
        "height": 0
    },
    {
        "lon": 112.98253667461312,
        "lat": 8.60109918773366,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.03312320150403,
        "lat": 8.825845309321785,
        "height": 0
    },
    {
        "lon": 113.07972379649046,
        "lat": 9.042801527214612,
        "height": 0
    },
    {
        "lon": 113.12219090835912,
        "lat": 9.246034565027786,
        "height": 0
    },
    {
        "lon": 113.16037478941887,
        "lat": 9.429614974008176,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.19475491774583,
        "lat": 9.596569000220976,
        "height": 0
    },
    {
        "lon": 113.22574133973832,
        "lat": 9.754733823545507,
        "height": 0
    },
    {
        "lon": 113.25307894799079,
        "lat": 9.905398514013577,
        "height": 0
    },
    {
        "lon": 113.2765126638043,
        "lat": 10.049851215025514,
        "height": 0
    },
    {
        "lon": 113.29578737167023,
        "lat": 10.189379122918645,
        "height": 0
    },
    {
        "lon": 113.31064784164572,
        "lat": 10.325268467946055,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.3208386397889,
        "lat": 10.458804483522039,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.32610402685928,
        "lat": 10.591271351817936,
        "height": 0
    },
    {
        "lon": 113.32618784552581,
        "lat": 10.723952114631407,
        "height": 0
    },
    {
        "lon": 113.32083339636499,
        "lat": 10.858128538908405,
        "height": 0
    },
    {
        "lon": 113.30549373038409,
        "lat": 10.993287472157991,
        "height": 0
    },
    {
        "lon": 113.27789128152314,
        "lat": 11.127814380095732,
        "height": 0
    },
    {
        "lon": 113.24117712912113,
        "lat": 11.261337187546584,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.19850824043367,
        "lat": 11.393483755259785,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.15304771437503,
        "lat": 11.523882757589707,
        "height": 0
    },
    {
        "lon": 113.1079648704692,
        "lat": 11.652164271095444,
        "height": 0
    },
    {
        "lon": 113.06643519490724,
        "lat": 11.777960041867962,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.03164016049396,
        "lat": 11.900903400273618,
        "height": 0
    },
    {
        "lon": 113.00676693676573,
        "lat": 12.020628793700224,
        "height": 0
    },
    {
        "lon": 112.9950080005814,
        "lat": 12.136770910779767,
        "height": 2.3283064365386963e-10
    },
    {
        "lon": 112.99672226610586,
        "lat": 12.248545094268245,
        "height": 0
    },
    {
        "lon": 113.00881714454256,
        "lat": 12.355896978395755,
        "height": 0
    },
    {
        "lon": 113.02930870389838,
        "lat": 12.459555353898196,
        "height": 0
    },
    {
        "lon": 113.05620952337351,
        "lat": 12.560248480444983,
        "height": 0
    },
    {
        "lon": 113.08752901278093,
        "lat": 12.658704623586228,
        "height": 0
    },
    {
        "lon": 113.12127364713707,
        "lat": 12.755652467431323,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.15544711547506,
        "lat": 12.851821390857179,
        "height": 0
    },
    {
        "lon": 113.18805037995729,
        "lat": 12.94794159706204,
        "height": 0
    },
    {
        "lon": 113.21708163971032,
        "lat": 13.044744087499478,
        "height": 0
    },
    {
        "lon": 113.24053619348494,
        "lat": 13.142960471644578,
        "height": 0
    },
    {
        "lon": 113.25449444690587,
        "lat": 13.239314081374932,
        "height": 0
    },
    {
        "lon": 113.25884663613908,
        "lat": 13.331227147714786,
        "height": 0
    },
    {
        "lon": 113.25730559732773,
        "lat": 13.420479451908875,
        "height": -1.0669640486491471e-9
    },
    {
        "lon": 113.25359005586058,
        "lat": 13.508850878672122,
        "height": 0
    },
    {
        "lon": 113.25142405395079,
        "lat": 13.598121906731514,
        "height": 0
    },
    {
        "lon": 113.25453706126493,
        "lat": 13.690073630887953,
        "height": 0
    },
    {
        "lon": 113.26666477183666,
        "lat": 13.786487276352577,
        "height": 0
    },
    {
        "lon": 113.29155058720501,
        "lat": 13.889143162596172,
        "height": 0
    },
    {
        "lon": 113.33294777403621,
        "lat": 13.99981906293654,
        "height": 0
    },
    {
        "lon": 113.39462226425466,
        "lat": 14.120287887590765,
        "height": 0
    },
    {
        "lon": 113.47941403881262,
        "lat": 14.253949222090862,
        "height": 0
    },
    {
        "lon": 113.58505671251518,
        "lat": 14.400833449756512,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 113.70766138676295,
        "lat": 14.55765401913038,
        "height": 0
    },
    {
        "lon": 113.84332625215059,
        "lat": 14.721126607320027,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 113.98813280905604,
        "lat": 14.887972154994493,
        "height": 0
    },
    {
        "lon": 114.13814339224473,
        "lat": 15.054919608123127,
        "height": 0
    },
    {
        "lon": 114.28939995887002,
        "lat": 15.218708198588097,
        "height": 0
    },
    {
        "lon": 114.437924076092,
        "lat": 15.376089065402512,
        "height": 0
    },
    {
        "lon": 114.57971802974008,
        "lat": 15.523826007474094,
        "height": 0
    },
    {
        "lon": 114.7107669696573,
        "lat": 15.65869516742987,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 114.83534140094345,
        "lat": 15.782902593792276,
        "height": 0
    },
    {
        "lon": 114.9599531156889,
        "lat": 15.901028364605208,
        "height": 0
    },
    {
        "lon": 115.0839367949829,
        "lat": 16.013418439114673,
        "height": 0
    },
    {
        "lon": 115.20662549017342,
        "lat": 16.120419302097098,
        "height": 0
    },
    {
        "lon": 115.32735078547945,
        "lat": 16.222378067490563,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 115.44544296300421,
        "lat": 16.319642547436796,
        "height": 0
    },
    {
        "lon": 115.56023116790507,
        "lat": 16.412561285962497,
        "height": 0
    },
    {
        "lon": 115.67104357160609,
        "lat": 16.50148355674504,
        "height": 0
    },
    {
        "lon": 115.77720753112459,
        "lat": 16.586759324586154,
        "height": 0
    },
    {
        "lon": 115.87804974282726,
        "lat": 16.668739170354716,
        "height": 0
    },
    {
        "lon": 115.97166554140176,
        "lat": 16.74312575141873,
        "height": 0
    },
    {
        "lon": 116.05766923862056,
        "lat": 16.807181110304125,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 116.1376726631477,
        "lat": 16.863592631783376,
        "height": 0
    },
    {
        "lon": 116.21329575485807,
        "lat": 16.915044449466063,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 116.28616531386243,
        "lat": 16.96421780998976,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 116.35791422281346,
        "lat": 17.013791364917584,
        "height": 0
    },
    {
        "lon": 116.43018113688427,
        "lat": 17.066441351223098,
        "height": 0
    },
    {
        "lon": 116.50461063641092,
        "lat": 17.124841626647882,
        "height": 0
    },
    {
        "lon": 116.58285383761626,
        "lat": 17.191663526474397,
        "height": 0
    },
    {
        "lon": 116.66656945704878,
        "lat": 17.269575503375293,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 116.75489199218741,
        "lat": 17.35878120768408,
        "height": 0
    },
    {
        "lon": 116.84564272385097,
        "lat": 17.456621534028482,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 116.93851485512091,
        "lat": 17.561468588282118,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 117.03319833157153,
        "lat": 17.67169496645581,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 117.12937956536202,
        "lat": 17.785673896294703,
        "height": 0
    },
    {
        "lon": 117.22674121037664,
        "lat": 17.90177939157246,
        "height": 0
    },
    {
        "lon": 117.32496198923167,
        "lat": 18.018386406930116,
        "height": 0
    },
    {
        "lon": 117.4237165730617,
        "lat": 18.13387097923684,
        "height": 0
    },
    {
        "lon": 117.52267551505591,
        "lat": 18.24661034036574,
        "height": 0
    },
    {
        "lon": 117.62150523874261,
        "lat": 18.35498298597956,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 117.72166364611975,
        "lat": 18.46281526532768,
        "height": 0
    },
    {
        "lon": 117.8243150240116,
        "lat": 18.573912669518656,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 117.92867771527517,
        "lat": 18.68662412668239,
        "height": 0
    },
    {
        "lon": 118.03396367453243,
        "lat": 18.799299692223755,
        "height": 0
    },
    {
        "lon": 118.13937826153897,
        "lat": 18.91029071004147,
        "height": 0
    },
    {
        "lon": 118.24412020653884,
        "lat": 19.01794997695238,
        "height": 0
    },
    {
        "lon": 118.3473817480848,
        "lat": 19.120631889968063,
        "height": 0
    },
    {
        "lon": 118.44834894366097,
        "lat": 19.21669255690712,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 118.54620215323989,
        "lat": 19.30448985271405,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 118.64011669563972,
        "lat": 19.382383406794688,
        "height": 0
    },
    {
        "lon": 118.72439032146055,
        "lat": 19.447667879249153,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 118.7966725145062,
        "lat": 19.500557454535162,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 118.86117512925273,
        "lat": 19.543785806193963,
        "height": 0
    },
    {
        "lon": 118.92212272678776,
        "lat": 19.58007931045514,
        "height": 0
    },
    {
        "lon": 118.9837494045924,
        "lat": 19.612158150830776,
        "height": 0
    },
    {
        "lon": 119.05029719614654,
        "lat": 19.642736594251488,
        "height": 0
    },
    {
        "lon": 119.1260159988702,
        "lat": 19.67452237036302,
        "height": 0
    },
    {
        "lon": 119.21516498468173,
        "lat": 19.710215096073746,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 119.32201543240883,
        "lat": 19.75250368180358,
        "height": 0
    },
    {
        "lon": 119.4508548949792,
        "lat": 19.804062634361696,
        "height": 0
    },
    {
        "lon": 119.60381268446386,
        "lat": 19.866167468494297,
        "height": 0
    },
    {
        "lon": 119.77768300108923,
        "lat": 19.936692498447517,
        "height": 0
    },
    {
        "lon": 119.96875762124351,
        "lat": 20.01320154797629,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 120.17331371947944,
        "lat": 20.093268042345624,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 120.3876108105399,
        "lat": 20.174478638814723,
        "height": -1.1406325468715177e-9
    },
    {
        "lon": 120.60788902212643,
        "lat": 20.2544362229881,
        "height": 0
    },
    {
        "lon": 120.83036862485558,
        "lat": 20.330762167757275,
        "height": 0
    },
    {
        "lon": 121.05125072170384,
        "lat": 20.401097735553254,
        "height": 0
    },
    {
        "lon": 121.26671898222837,
        "lat": 20.46310450022281,
        "height": 0
    },
    {
        "lon": 121.47294229771732,
        "lat": 20.51446367161092,
        "height": 0
    },
    {
        "lon": 121.67621310150385,
        "lat": 20.55066270972602,
        "height": 0
    },
    {
        "lon": 121.88393608046289,
        "lat": 20.57160034910939,
        "height": 0
    },
    {
        "lon": 122.09395287870404,
        "lat": 20.581595377248238,
        "height": 0
    },
    {
        "lon": 122.3041252839855,
        "lat": 20.584976435805295,
        "height": 0
    },
    {
        "lon": 122.51233703630338,
        "lat": 20.58608237168231,
        "height": 0
    },
    {
        "lon": 122.7164944842164,
        "lat": 20.589262143846515,
        "height": 0
    },
    {
        "lon": 122.91452606958511,
        "lat": 20.59887435411663,
        "height": 0
    },
    {
        "lon": 123.10438062468633,
        "lat": 20.61928647491983,
        "height": 0
    },
    {
        "lon": 123.28402446763972,
        "lat": 20.654873832884853,
        "height": 0
    },
    {
        "lon": 123.45143728247433,
        "lat": 20.71001837397528,
        "height": 0
    },
    {
        "lon": 123.60881758417928,
        "lat": 20.780796127342022,
        "height": 0
    },
    {
        "lon": 123.75953005591795,
        "lat": 20.86051833893854,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 123.9033096337037,
        "lat": 20.949424281951483,
        "height": 0
    },
    {
        "lon": 124.03988970142237,
        "lat": 21.04775374241508,
        "height": 0
    },
    {
        "lon": 124.16900169664436,
        "lat": 21.155746991078566,
        "height": 0
    },
    {
        "lon": 124.29037469374346,
        "lat": 21.273644740681405,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 124.40373496388418,
        "lat": 21.401688085583185,
        "height": 0
    },
    {
        "lon": 124.50880551140233,
        "lat": 21.540118420432,
        "height": 0
    },
    {
        "lon": 124.60530558606979,
        "lat": 21.689177334280714,
        "height": 0
    },
    {
        "lon": 124.69295017069685,
        "lat": 21.8491064762738,
        "height": 0
    },
    {
        "lon": 124.7696678847923,
        "lat": 22.02807362731545,
        "height": 0
    },
    {
        "lon": 124.83459824738655,
        "lat": 22.230393829472344,
        "height": 0
    },
    {
        "lon": 124.8892583066089,
        "lat": 22.450524084738326,
        "height": 0
    },
    {
        "lon": 124.93515598019313,
        "lat": 22.682914690935867,
        "height": 0
    },
    {
        "lon": 124.97379561807567,
        "lat": 22.92201051179624,
        "height": 0
    },
    {
        "lon": 125.0066824033459,
        "lat": 23.162252702853127,
        "height": 0
    },
    {
        "lon": 125.0353255764538,
        "lat": 23.39808065067372,
        "height": -1.3969838619232178e-9
    },
    {
        "lon": 125.06124045963817,
        "lat": 23.623933834899987,
        "height": 0
    },
    {
        "lon": 125.0859492538997,
        "lat": 23.834253307767455,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 125.11098057973429,
        "lat": 24.02348250422779,
        "height": 0
    },
    {
        "lon": 125.13328110049667,
        "lat": 24.193120878383013,
        "height": 0
    },
    {
        "lon": 125.1495529670787,
        "lat": 24.349930940882913,
        "height": 0
    },
    {
        "lon": 125.16095040365727,
        "lat": 24.496140508314678,
        "height": 0
    },
    {
        "lon": 125.16862169442602,
        "lat": 24.633850767725963,
        "height": 0
    },
    {
        "lon": 125.1737177201626,
        "lat": 24.76505764213327,
        "height": 0
    },
    {
        "lon": 125.17739656242088,
        "lat": 24.89166529179318,
        "height": 0
    },
    {
        "lon": 125.18082408674138,
        "lat": 25.015492329777693,
        "height": 0
    },
    {
        "lon": 125.18517040936113,
        "lat": 25.138271260107125,
        "height": 0
    },
    {
        "lon": 125.19160220552588,
        "lat": 25.261641683493284,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 125.20127093294442,
        "lat": 25.387137948172985,
        "height": 0
    },
    {
        "lon": 125.21442885227596,
        "lat": 25.523295118865313,
        "height": 0
    },
    {
        "lon": 125.2299530576682,
        "lat": 25.672438343132345,
        "height": 0
    },
    {
        "lon": 125.24692339513538,
        "lat": 25.82690368954774,
        "height": 4.656612873077393e-10
    },
    {
        "lon": 125.2644476303054,
        "lat": 25.97939386554584,
        "height": 0
    },
    {
        "lon": 125.28167170163128,
        "lat": 26.123040625099147,
        "height": 0
    },
    {
        "lon": 125.29778388676593,
        "lat": 26.251408451110162,
        "height": 0
    },
    {
        "lon": 125.31201348507717,
        "lat": 26.358447299957582,
        "height": 0
    },
    {
        "lon": 125.32362468091276,
        "lat": 26.438401972097612,
        "height": 0
    },
    {
        "lon": 125.33615697815517,
        "lat": 26.49470930843163,
        "height": 4.656612873077393e-10
    }
],
        detectionRange: {
        radius: 1000000,
        startAngle: 0,
        endAngle: 30,
        color: "green",
      },
      fireRange: {
        radius: 2000000,
        color: Cesium.Color.RED,
      },
      signalSource: {
        distance: 1000000,
        color: "blue",
      },
        speed: 100,
        startTime: startTime,
        endTime: endTime,
        imageUrl: "./img/航母.svg",
        trackWidth: 1,
        labelFont:"12pt 微软雅黑",
      }
      const hmEntity = mapTool.drawMovingStation(carrierMovingStationParams);

      //火力范围
       if (carrierMovingStationParams.fireRange && hmEntity) {
        const fr = carrierMovingStationParams.fireRange;
        const center = hmEntity.position;
        if (!center) return;
        mapTool.drawFireControlRangeCircle({
          center: center,
          radius: fr.radius,
          color: fr.color,
          height: fr.height,
          name: fr.name,
          ownerId: hmEntity.id,
        });
      }  

      if (stationEntity && hmEntity) {
        mapTool.signalSourceInteraction(stationEntity, hmEntity, 1000);
      }


}


fetch("/config.json").then((result) => {
  if (result.ok)
    result.json().then((res) => {
      useConfigStore().updateConfig(res);
    });
});


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


  // 初始化播放倍速为 1x
  mapTool.setPlaybackRate(1);

  //初始化底部时间滑动块两侧时间
  timelineStartText.value = "2026-03-12 10:00:00";
  timelineEndText.value = "2026-03-16 10:00:00";

  test();

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
  if (v) startTimelineSync();
  else stopTimelineSync();
});



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
          <el-button type="primary" size="small" @click="togglePlay">
            {{ isPlaying ? "暂停" : "播放" }}
          </el-button>
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
          :type="mapTool.battleRangeVisible ? 'success' : 'info'"
          :plain="!mapTool.battleRangeVisible"
          size="small"
          @click="toggleAllBattleRanges()"
        >
          作战范围: {{ mapTool.battleRangeVisible.value==true ? '已开启' : '已关闭' }}
        </el-button>
      </div>

      <div class="switch-group">
        <el-button
          :type="mapTool.signalSourceVisible ? 'success' : 'info'"
          :plain="!mapTool.signalSourceVisible"
          size="small"
          @click="toggleAllSignalSources()"
        >
          信号源: {{ mapTool.signalSourceVisible.value==true ? '已开启' : '已关闭' }}
        </el-button>
      </div>

      <div class="switch-group">
        <el-button
          :type="mapTool.detectionRangeVisible ? 'success' : 'info'"
          :plain="!mapTool.detectionRangeVisible"
          size="small"
          @click="toggleAllDetectionRanges()"
        >
          能力探测范围: {{ mapTool.detectionRangeVisible.value==true ? '已开启' : '已关闭' }}
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
            :min="0"
            :max="100"
            :step="0.1"
            :show-tooltip="false"
            @input="onTimelineInput"
            @change="endTimelineDrag"
          />
        </div>
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
      <div class="context-menu-item" @click="mapTool.clearDrawShapes()">清除所有标绘</div>
    </div>

    <!-- 绘制航迹提示 -->
    <div v-if="isDrawingPath" id="drawingHint">
      正在绘制航迹：左键点击地图添加点，右键或ESC结束绘制
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
    top: 50%;
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
}
</style>

