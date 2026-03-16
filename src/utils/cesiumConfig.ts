import * as Cesium from "cesium";

/**
 * 配置 Cesium 使用离线资源
 * vite-plugin-cesium 会自动处理 Cesium 静态资源的路径
 */
export function configureCesiumOffline() {
  // vite-plugin-cesium 会自动设置 CESIUM_BASE_URL
  // 如果需要自定义路径，可以取消下面的注释并设置
  // if (import.meta.env.DEV) {
  //   window.CESIUM_BASE_URL = "/node_modules/cesium/Build/Cesium/";
  // } else {
  //   window.CESIUM_BASE_URL = "./node_modules/cesium/Build/Cesium/";
  // }

  // 禁用 Ion 默认访问令牌（如果需要完全离线）
  // 注意：这不会影响 Cesium 的核心功能，只是禁用 Ion 服务
  // Cesium.Ion.defaultAccessToken = "";
}

/**
 * 创建离线地图瓦片提供者
 * 使用 OpenStreetMap 离线瓦片或自定义瓦片服务
 */
export function createOfflineImageryProvider(
  urlTemplate: string = "/maps/{z}/{x}/{y}.png",
  options?: {
    minimumLevel?: number;
    maximumLevel?: number;
    credit?: string;
  }
): Cesium.UrlTemplateImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: urlTemplate,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    // 重要：必须匹配你本地实际存在的瓦片层级，否则 Cesium 会请求不存在的 z 导致空白/断层
    // 当前仓库 public/maps 下最高只有 z=5
    minimumLevel: options?.minimumLevel ?? 1,
    maximumLevel: options?.maximumLevel ?? 5,
    credit: options?.credit ?? "离线地图",
  });
}

/**
 * 创建颜色底图提供者（简单离线方案）
 * 使用静态图片文件避免 sandbox 问题
 */
export function createColorImageryProvider(
  color: string = "#1e1e1e"
): Cesium.SingleTileImageryProvider {
  // 使用 public 目录下的静态图片文件
  return new Cesium.SingleTileImageryProvider({
    url: "/blank.png",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
  });
}

/**
 * 创建空白底图提供者（使用静态文件）
 */
export function createBlankImageryProvider(): Cesium.SingleTileImageryProvider {
  return new Cesium.SingleTileImageryProvider({
    url: "/blank.png",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
  });
}
